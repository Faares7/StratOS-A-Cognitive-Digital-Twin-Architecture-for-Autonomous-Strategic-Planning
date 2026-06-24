/**
 * strategyApi.ts
 * HTTP client for all Strategy Planner endpoints.
 *
 * POST /api/agents/strategy/run          → run pipeline, returns job_id
 * GET  /api/jobs/{jobId}                 → poll (carries job.progress live)
 * GET  /api/strategy/goals/{runId}       → fetch plan with enriched provenance
 * POST /api/strategy/{runId}/approve     → finalize plan
 * PATCH/DELETE/POST  …goals…objectives   → full CRUD + reorder + reset
 */

import type {
  FeasibilityResult,
  StrategyPlan,
  StrategyProgress,
} from "@/types";

const BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS  = 5_400_000;  // 90 min — grounding on CPU can be slow with large datasets

// ── Run + poll ────────────────────────────────────────────────────────────────

export async function runStrategy(swotRunId?: string): Promise<string> {
  const res = await fetch(`${BASE}/api/agents/strategy/run`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ swot_run_id: swotRunId ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to start strategy run: ${await res.text()}`);
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}

export async function pollStrategy(
  jobId: string,
  onProgress: (p: StrategyProgress) => void,
): Promise<{ strategy_run_id: string; validated: boolean }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    if (Date.now() > deadline) {
      throw new Error("Strategy generation timed out — the local LLM may be unavailable.");
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${BASE}/api/jobs/${jobId}`);
    if (!res.ok) continue;

    const job = (await res.json()) as {
      status:    "running" | "complete" | "failed";
      progress?: StrategyProgress;
      result?:   { strategy_run_id: string; validated: boolean; errors: string[] };
      error?:    string;
    };

    if (job.progress) onProgress(job.progress);
    if (job.status === "complete") return job.result!;
    if (job.status === "failed")   throw new Error(job.error ?? "Strategy run failed.");
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function fetchLatestRunId(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/strategy/latest-run-id`);
    if (!res.ok) return null;
    const { run_id } = (await res.json()) as { run_id: string };
    return run_id ?? null;
  } catch {
    return null;
  }
}

export async function fetchPlan(runId: string): Promise<StrategyPlan> {
  const res = await fetch(`${BASE}/api/strategy/goals/${runId}`);
  if (!res.ok) throw new Error(`Failed to fetch plan: ${await res.text()}`);
  return res.json() as Promise<StrategyPlan>;
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approvePlan(
  runId: string,
  force = false,
): Promise<{ plan_status: string; finalized_at: string }> {
  const res = await fetch(
    `${BASE}/api/strategy/${runId}/approve${force ? "?force=true" : ""}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Approve failed: ${await res.text()}`);
  return res.json();
}

// ── Feasibility (HITL preview) ────────────────────────────────────────────────

export async function checkFeasibility(
  kind: "goal" | "objective",
  runId: string,
  text: string,
  ids?: { goalId?: string; objectiveId?: string },
): Promise<FeasibilityResult> {
  const res = await fetch(`${BASE}/api/strategy/feasibility/${kind}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      run_id:       runId,
      text,
      goal_id:      ids?.goalId ?? null,
      objective_id: ids?.objectiveId ?? null,
    }),
  });
  if (!res.ok) throw new Error(`Feasibility check failed: ${await res.text()}`);
  return res.json() as Promise<FeasibilityResult>;
}

// ── Goal CRUD ─────────────────────────────────────────────────────────────────

export async function patchGoal(
  goalId: string,
  fields: { title?: string; description?: string; reset?: boolean },
): Promise<void> {
  await fetch(`${BASE}/api/strategy/goals/${goalId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(fields),
  });
}

export async function addGoal(
  runId: string,
  title: string,
  description = "",
): Promise<{ goal_id: string; position: number }> {
  const res = await fetch(`${BASE}/api/strategy/goals/${runId}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ title, description }),
  });
  if (!res.ok) throw new Error(`Failed to add goal: ${await res.text()}`);
  return res.json();
}

export async function deleteGoal(goalId: string): Promise<void> {
  await fetch(`${BASE}/api/strategy/goals/${goalId}`, { method: "DELETE" });
}

export async function reorderGoals(orderedIds: string[]): Promise<void> {
  await fetch(`${BASE}/api/strategy/goals/reorder`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ordered_ids: orderedIds }),
  });
}

// ── Objective CRUD ────────────────────────────────────────────────────────────

export async function patchObjective(
  objectiveId: string,
  fields: { text?: string; reset?: boolean },
): Promise<void> {
  await fetch(`${BASE}/api/strategy/objectives/${objectiveId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(fields),
  });
}

export async function addObjective(
  goalId: string,
  text: string,
): Promise<{ objective_id: string; position: number }> {
  const res = await fetch(`${BASE}/api/strategy/objectives/${goalId}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Failed to add objective: ${await res.text()}`);
  return res.json();
}

export async function deleteObjective(objectiveId: string): Promise<void> {
  await fetch(`${BASE}/api/strategy/objectives/${objectiveId}`, {
    method: "DELETE",
  });
}

export async function reorderObjectives(orderedIds: string[]): Promise<void> {
  await fetch(`${BASE}/api/strategy/objectives/reorder`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ordered_ids: orderedIds }),
  });
}
