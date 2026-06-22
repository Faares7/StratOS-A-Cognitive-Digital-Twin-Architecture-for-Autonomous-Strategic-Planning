/**
 * ocrApi.ts
 * HTTP client for the StratOS OCR endpoints.
 * Handles PDF upload, job polling, and section retrieval.
 */

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

export type SectionType = "static" | "dynamic" | "unknown";

export interface PlanSection {
  id?: string;
  upload_id: string;
  filename: string;
  section_key: string;
  section_type: SectionType;
  title_ar: string;
  content: string;
  page_start: number;
  page_end: number;
  created_at?: string;
}

export interface OcrResult {
  upload_id: string;
  filename: string;
  sections: PlanSection[];
  total_pages: number;
  mode?: "docai+pdfium" | "pdfium_only" | "md_parse";
  stats: {
    docai: number;
    hybrid: number;
    fallback: number;
    empty: number;
  };
}

export interface UploadSummary {
  upload_id: string;
  filename: string;
  total_sections: number;
  static_count: number;
  dynamic_count: number;
  uploaded_at: string;
}

type JobStatus = {
  status: "running" | "complete" | "failed";
  result?: OcrResult;
  error?: string;
  started_at: string;
  finished_at?: string;
};

// ── Core helpers ──────────────────────────────────────────────────────────────

async function pollJob(jobId: string, intervalMs = 3000): Promise<OcrResult> {
  while (true) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`Job poll failed: ${res.status}`);
    const job = (await res.json()) as JobStatus;
    if (job.status === "complete") return job.result as OcrResult;
    if (job.status === "failed") throw new Error(job.error ?? "OCR job failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upload a PDF, wait for OCR processing to complete, and return extracted sections.
 * Pass an optional onProgress callback to receive intermediate status messages.
 */
export async function uploadAndExtract(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<OcrResult> {
  onProgress?.("Uploading PDF…");
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/ocr/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${body}`);
  }
  const { job_id } = (await res.json()) as { job_id: string };

  onProgress?.("Extracting text with Document AI…");
  const result = await pollJob(job_id);
  onProgress?.("Done");
  return result;
}

/**
 * Upload a pre-extracted .md file and classify its sections server-side.
 * No Document AI is called — zero cloud API costs. Use for development/testing.
 */
export async function uploadAndParseMd(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<OcrResult> {
  onProgress?.("Uploading markdown file…");
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/ocr/parse-md`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MD parse failed: ${body}`);
  }
  const { job_id } = (await res.json()) as { job_id: string };
  onProgress?.("Classifying sections…");
  const result = await pollJob(job_id);
  onProgress?.("Done");
  return result;
}

/** List all previously uploaded plans (by upload_id). */
export async function listUploads(): Promise<UploadSummary[]> {
  const res = await fetch(`${BASE_URL}/api/ocr/sections`);
  if (!res.ok) throw new Error("Failed to list uploads");
  const data = (await res.json()) as { uploads: UploadSummary[] };
  return data.uploads;
}

/** Fetch all sections for a specific upload. */
export async function getSections(uploadId: string): Promise<PlanSection[]> {
  const res = await fetch(`${BASE_URL}/api/ocr/sections/${uploadId}`);
  if (!res.ok) throw new Error("Sections not found");
  const data = (await res.json()) as { sections: PlanSection[] };
  return data.sections;
}
