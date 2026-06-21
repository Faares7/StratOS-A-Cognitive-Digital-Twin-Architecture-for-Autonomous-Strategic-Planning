/**
 * swotConsolidationApi.ts
 * HTTP client for the SWOT consolidation review gate.
 *
 *   runConsolidation()  → POST /api/swot-consolidation/run  then polls /api/jobs/{id}
 *   fetchLatest()       → GET  /api/swot-consolidation/latest
 *   patchCandidate()    → PATCH /api/swot-consolidation/candidates/{id}
 *   deleteCandidate()   → DELETE /api/swot-consolidation/candidates/{id}
 *   addCandidate()      → POST  /api/swot-consolidation/candidates
 *
 * The consolidated, human-reviewed items are what the rest of the architecture
 * (gap analysis, goals) consumes — only candidates with reviewer_decision !== 'cut'.
 */

const BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

const POLL_INTERVAL_MS = 3_000;
// First run normalizes the whole previous plan via local Ollama and can take a while; the
// result is cached server-side so later runs are fast. The job persists to the DB even if
// this poll gives up, so on timeout the user can just Refresh to pull the saved result.
const POLL_TIMEOUT_MS = 1_500_000; // 25 min

export type SwotBranch = "internal" | "external";
export type SwotType = "strength" | "weakness" | "opportunity" | "threat";
export type ReviewDecision = "keep" | "cut" | "pending";

export interface SwotCandidate {
  candidate_id: string;
  consolidation_run_id: string;
  branch: SwotBranch;
  type: SwotType;
  pillar_id: number | null;
  pillar_name: string | null;
  title: string | null;
  description: string;
  salience_score: number;
  lifecycle_state: "new" | "persistent" | "carried_forward" | "resolved";
  selected: boolean;
  reviewer_decision: ReviewDecision;
  selection_reason: string | null;
  factor_breakdown: Record<string, unknown>;
  member_item_ids: string[];
  created_at: string;
  approved: boolean;
  approved_at: string | null;
}

export interface LatestConsolidation {
  consolidation_run_id: string | null;
  candidates: SwotCandidate[];
  approved_at: string | null;
}

export async function approveSwot(consolidationRunId: string): Promise<{ approved_at: string }> {
  const res = await fetch(`${BASE}/api/swot-consolidation/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consolidation_run_id: consolidationRunId }),
  });
  if (!res.ok) throw new Error(`Failed to approve: ${await res.text()}`);
  return res.json() as Promise<{ approved_at: string }>;
}

// ── Trigger a consolidation run (long; job-polled) ──────────────────────────────

export async function runConsolidation(onPoll?: () => void): Promise<{ consolidation_run_id: string; candidate_count: number }> {
  const submit = await fetch(`${BASE}/api/swot-consolidation/run`, { method: "POST" });
  if (!submit.ok) throw new Error(`Failed to start consolidation: ${await submit.text()}`);

  const { job_id } = (await submit.json()) as { job_id: string };
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    if (Date.now() > deadline) throw new Error("Still running in the background — click Refresh in a minute to load the saved result.");
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    onPoll?.();

    const pollRes = await fetch(`${BASE}/api/jobs/${job_id}`);
    if (!pollRes.ok) continue;
    const job = (await pollRes.json()) as {
      status: "running" | "complete" | "failed";
      result?: { consolidation_run_id: string; candidate_count: number };
      error?: string;
    };
    if (job.status === "complete") return job.result!;
    if (job.status === "failed") throw new Error(job.error ?? "Consolidation failed on the backend.");
  }
}

// ── Fire-and-forget run (non-blocking) — the LLM job runs server-side and persists ──
// regardless of the UI. The dialog kicks this off, keeps the editor fully usable, and
// polls getJobStatus in the background to auto-refresh when it's done. This is why the
// LLM being slow can never block or "time out" the editing experience.

export async function startConsolidation(): Promise<string> {
  const res = await fetch(`${BASE}/api/swot-consolidation/run`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start consolidation: ${await res.text()}`);
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}

export async function getJobStatus(jobId: string): Promise<{
  status: "running" | "complete" | "failed";
  error?: string;
}> {
  const res = await fetch(`${BASE}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job poll failed: ${res.status}`);
  return res.json();
}

// ── Load the latest run's ranked candidates ─────────────────────────────────────

export async function fetchLatest(includeCarried = false): Promise<LatestConsolidation> {
  const res = await fetch(`${BASE}/api/swot-consolidation/latest?include_carried=${includeCarried}`);
  if (!res.ok) throw new Error(`Failed to load consolidation: ${await res.text()}`);
  return res.json() as Promise<LatestConsolidation>;
}

// ── Edit / keep-cut a candidate ─────────────────────────────────────────────────

export async function patchCandidate(
  candidateId: string,
  patch: Partial<Pick<SwotCandidate, "title" | "description" | "type" | "pillar_id" | "pillar_name" | "reviewer_decision" | "selected">>,
): Promise<void> {
  const res = await fetch(`${BASE}/api/swot-consolidation/candidates/${candidateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update item: ${await res.text()}`);
}

// ── Delete a candidate ──────────────────────────────────────────────────────────

export async function deleteCandidate(candidateId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/swot-consolidation/candidates/${candidateId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete item: ${await res.text()}`);
}

// ── Add a manual candidate ──────────────────────────────────────────────────────

export interface NewCandidate {
  consolidation_run_id: string;
  branch: SwotBranch;
  type: SwotType;
  description: string;
  title?: string | null;
  pillar_id?: number | null;
  pillar_name?: string | null;
}

export async function addCandidate(item: NewCandidate): Promise<{ candidate_id: string }> {
  const res = await fetch(`${BASE}/api/swot-consolidation/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to add item: ${await res.text()}`);
  return res.json() as Promise<{ candidate_id: string }>;
}
