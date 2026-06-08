/**
 * Thin client for the FastAPI backend (`server/main.py`). Every call is a
 * plain `fetch` — no data-fetching library needed for an app this size, and
 * keeping it explicit makes the SSE-over-POST stream (which no library
 * handles out of the box) sit naturally alongside the rest.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type Config = {
  runner_model: string;
  optimizer_model: string;
  evaluator_model: string;
  n_iterations: number;
  n_samples: number;
  dimensions: string[];
  api_key_configured: boolean;
};

export type Preset = { id: string; label: string; prompt: string };

export type Stats = {
  session_count: number;
  iteration_count: number;
  best_score: number | null;
  avg_final_score: number | null;
};

export type Dimensions = {
  accuracy: number;
  clarity: number;
  completeness: number;
  conciseness: number;
};

export type RawScore = {
  critique?: string;
  total?: number;
  accuracy?: number;
  clarity?: number;
  completeness?: number;
  conciseness?: number;
};

export type SessionSummary = {
  id: number;
  name: string | null;
  original_prompt: string;
  created_at: string;
  runner_model: string;
  optimizer_model: string;
  evaluator_model: string;
  iteration_count: number;
  first_score: number | null;
  latest_score: number | null;
  delta: number | null;
};

export type Iteration = {
  id: number;
  session_id: number;
  iteration: number;
  prompt: string;
  avg_total: number;
  avg_dimensions: Dimensions;
  critique: string;
  raw_scores: RawScore[];
  outputs: string[];
};

export type SessionDetail = SessionSummary & { iterations: Iteration[] };

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { "Content-Type": "application/json" };

export const api = {
  config: () => request<Config>("/api/config"),
  presets: () => request<Preset[]>("/api/presets"),
  stats: () => request<Stats>("/api/stats"),
  sessions: () => request<SessionSummary[]>("/api/sessions"),
  session: (id: number) => request<SessionDetail>(`/api/sessions/${id}`),
  rename: (id: number, name: string | null) =>
    request<SessionSummary>(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ name }),
    }),
  remove: (id: number) => request<{ deleted: number }>(`/api/sessions/${id}`, { method: "DELETE" }),
  exportCsvUrl: (id: number) => `${API_BASE}/api/sessions/${id}/export.csv`,
};

export { ApiError };

// ─── Live optimization stream ───────────────────────────────────────────────

export type EvalResult = { avg_total: number; avg_dimensions: Dimensions; scores: RawScore[] };

export type OptimizeEvent =
  | { type: "session_created"; session_id: number }
  | { type: "iteration_start"; iteration: number; prompt: string }
  | { type: "outputs"; iteration: number; outputs: string[] }
  | { type: "scores"; iteration: number; eval_result: EvalResult }
  | { type: "rewritten"; iteration: number; new_prompt: string }
  | { type: "iteration_complete"; iteration: number; record: Iteration & { raw_scores: RawScore[] } }
  | { type: "done"; history: unknown[] }
  | { type: "error"; message: string };

export type OptimizeRequest = {
  prompt: string;
  n_iterations?: number;
  n_samples?: number;
  name?: string | null;
};

/**
 * POST /api/optimize and yield each Server-Sent Event as it streams in.
 *
 * Browsers' `EventSource` only issues GET requests (and a full prompt is too
 * large/awkward for a query string), so we POST with `fetch` and parse the
 * `text/event-stream` body ourselves via a reader — a well-trodden pattern
 * for SSE-over-POST that keeps the backend route perfectly conventional.
 */
export async function* streamOptimize(
  body: OptimizeRequest,
  signal?: AbortSignal,
): AsyncGenerator<OptimizeEvent> {
  const res = await fetch(`${API_BASE}/api/optimize`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(res.status, detail?.detail ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      if (!payload || payload === "{}") continue;
      try {
        yield JSON.parse(payload) as OptimizeEvent;
      } catch {
        // Ignore a malformed frame rather than killing the whole stream.
      }
    }
  }
}
