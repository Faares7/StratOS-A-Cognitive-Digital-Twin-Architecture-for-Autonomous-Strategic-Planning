/**
 * agentApi.ts
 * Real HTTP client for the StratOS FastAPI backend.
 * Provides trigger + polling helpers for all four LangGraph agents.
 */

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

export type AgentName = "tech" | "benchmark" | "workforce" | "sentiment" | "social";

export type JobStatus = {
  status: "running" | "complete" | "failed";
  result?: unknown;
  error?: string;
  started_at: string;
  finished_at?: string;
};

// ── Core primitives ───────────────────────────────────────────────────────────

/** Returns true if the FastAPI backend is reachable. */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** POST to /api/agents/{name}/run — returns the job_id string. */
export async function triggerAgent(agentName: AgentName): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/agents/${agentName}/run`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to start ${agentName} agent: ${body}`);
  }
  const data = (await res.json()) as { job_id: string };
  return data.job_id;
}

/** GET /api/jobs/{jobId} — returns the current job record. */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job status");
  return res.json() as Promise<JobStatus>;
}

// ── High-level poller ────────────────────────────────────────────────────────

interface PollOptions {
  /** How often to re-check, in ms. Default: 2000 */
  intervalMs?: number;
  /**
   * Abort after this many ms. Default: 3_600_000 (60 min).
   * Set high because the Sentiment Agent uses local Ollama which can be slow.
   */
  timeoutMs?: number;
  /** Called on every poll tick (useful for spinner updates). */
  onPoll?: () => void;
}

/**
 * Triggers an agent and polls until it completes, then returns the result.
 * Throws on failure or timeout.
 */
export async function runAgentAndWait(
  agentName: AgentName,
  options: PollOptions = {}
): Promise<unknown> {
  const { intervalMs = 2_000, timeoutMs = 3_600_000, onPoll } = options;
  const jobId = await triggerAgent(agentName);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (Date.now() > deadline) {
      throw new Error(`${agentName} agent timed out after 10 minutes`);
    }
    const job = await getJobStatus(jobId);
    if (job.status === "complete") return job.result;
    if (job.status === "failed") {
      throw new Error(job.error ?? `${agentName} agent failed`);
    }
    onPoll?.();
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
}
