/**
 * gapAnalysisApi.ts
 * HTTP client for the HITL Gap Analysis endpoints.
 *
 * Phase 1 — fetchGapDraft()      → GET  /api/gap-analysis/draft
 * Phase 2 — calculateGap()       → POST /api/gap-analysis/calculate
 *                                   then polls GET /api/jobs/{jobId}
 * HITL add  — suggestOne()       → POST /api/gap-analysis/suggest-one
 *                                   then polls GET /api/jobs/{jobId}
 * HITL save  — approveSuggestion() → POST /api/gap-analysis/feedback
 */

import type { GapDraft, GapCalculationResult, GapSuggestion, FeedbackRequest, PillarDraft } from "@/types";

const BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS  = 600_000; // 10 min — local Ollama can be slow

// ── Phase 1 ───────────────────────────────────────────────────────────────────

export async function fetchGapDraft(): Promise<GapDraft> {
  const res = await fetch(`${BASE}/api/gap-analysis/draft`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch gap draft: ${body}`);
  }
  return res.json() as Promise<GapDraft>;
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

export async function calculateGap(
  pillars: PillarDraft[],
  onPoll?: () => void,
): Promise<GapCalculationResult> {
  // Submit the job
  const submitRes = await fetch(`${BASE}/api/gap-analysis/calculate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ pillars }),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Failed to start gap calculation: ${body}`);
  }

  const { job_id } = (await submitRes.json()) as { job_id: string };
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  // Poll until complete
  while (true) {
    if (Date.now() > deadline) {
      throw new Error("Gap calculation timed out — the local LLM may be unavailable.");
    }

    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    onPoll?.();

    const pollRes = await fetch(`${BASE}/api/jobs/${job_id}`);
    if (!pollRes.ok) continue;

    const job = (await pollRes.json()) as {
      status: "running" | "complete" | "failed";
      result?: GapCalculationResult;
      error?: string;
    };

    if (job.status === "complete") return job.result!;
    if (job.status === "failed") {
      throw new Error(job.error ?? "Gap calculation failed on the backend.");
    }
  }
}

// ── HITL: generate a single suggestion from user query ────────────────────────

export async function suggestOne(
  pillarData: PillarDraft,
  userQuery: string,
  onPoll?: () => void,
): Promise<GapSuggestion> {
  const submitRes = await fetch(`${BASE}/api/gap-analysis/suggest-one`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ pillar_data: pillarData, user_query: userQuery }),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Failed to start suggestion generation: ${body}`);
  }

  const { job_id } = (await submitRes.json()) as { job_id: string };
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    if (Date.now() > deadline) {
      throw new Error("Suggestion generation timed out — the local LLM may be unavailable.");
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    onPoll?.();

    const pollRes = await fetch(`${BASE}/api/jobs/${job_id}`);
    if (!pollRes.ok) continue;

    const job = (await pollRes.json()) as {
      status: "running" | "complete" | "failed";
      result?: GapSuggestion;
      error?: string;
    };

    if (job.status === "complete") return job.result!;
    if (job.status === "failed") {
      throw new Error(job.error ?? "Suggestion generation failed on the backend.");
    }
  }
}

// ── HITL: persist an approved suggestion as few-shot feedback ─────────────────

export async function approveSuggestion(req: FeedbackRequest): Promise<void> {
  const res = await fetch(`${BASE}/api/gap-analysis/feedback`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to save feedback: ${body}`);
  }
}
