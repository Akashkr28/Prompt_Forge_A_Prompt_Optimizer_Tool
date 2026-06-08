"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ScreenHeader, ScreenBody } from "@/components/ui/screen-header";
import { api, ApiError, type SessionSummary } from "@/lib/api";
import { formatDate, formatDelta, formatScore, scoreTextClass, truncate } from "@/lib/format";

const COLUMNS = ["#", "Name / Prompt", "Created", "Iters", "Start score", "Final score", "Δ", "Status", ""];

/** `screen-history` — searchable session table with view/export/rename/delete actions. */
export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setError(null);
    api
      .sessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.name, s.original_prompt, s.runner_model, s.optimizer_model, s.evaluator_model]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q)),
    );
  }, [sessions, query]);

  async function handleRename(session: SessionSummary) {
    const next = window.prompt("Session name (leave blank to clear):", session.name ?? "");
    if (next === null) return;
    setBusyId(session.id);
    try {
      const updated = await api.rename(session.id, next.trim() || null);
      setSessions((prev) => prev?.map((s) => (s.id === session.id ? updated : s)) ?? prev);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Couldn't rename this session.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(session: SessionSummary) {
    if (!window.confirm(`Delete session #${session.id}? This can't be undone.`)) return;
    setBusyId(session.id);
    try {
      await api.remove(session.id);
      setSessions((prev) => prev?.filter((s) => s.id !== session.id) ?? prev);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Couldn't delete this session.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <ScreenHeader
        eyebrow="Workspace · Sessions"
        title="Session History"
        sub="All past optimization runs. Export to CSV for deeper analysis."
      />
      <ScreenBody>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, prompt, or model…"
            className="max-w-[320px] flex-1 rounded-md border border-border bg-paper px-3 py-2.5 font-mono text-xs text-ink outline-none transition-colors focus:border-accent-2"
          />
          <Button variant="ghost" size="sm" onClick={load}>
            Refresh
          </Button>
          {sessions && (
            <span className="font-mono text-[11px] text-muted">
              {filtered.length} of {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {error && (
          <Card>
            <CardBody>
              <p className="font-mono text-xs text-accent">{error}</p>
            </CardBody>
          </Card>
        )}

        {!error && sessions === null && (
          <Card>
            <CardBody>
              <p className="font-mono text-xs text-muted">Loading sessions…</p>
            </CardBody>
          </Card>
        )}

        {!error && sessions !== null && sessions.length === 0 && (
          <Card>
            <EmptyState
              icon="◌"
              title="No sessions yet"
              sub="Runs you start from the Optimizer screen will show up here, with full history, scores, and exports."
              action={
                <Link href="/">
                  <Button variant="accent" size="sm" className="mt-1">
                    Go to Optimizer
                  </Button>
                </Link>
              }
            />
          </Card>
        )}

        {!error && sessions !== null && sessions.length > 0 && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-xs">
                <thead>
                  <tr>
                    {COLUMNS.map((h) => (
                      <th
                        key={h}
                        className="border-b border-border bg-cream px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.08em] text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const status: "done" | "failed" = s.iteration_count > 0 ? "done" : "failed";
                    const d = formatDelta(s.delta);
                    return (
                      <tr key={s.id} className="transition-colors hover:bg-cream">
                        <td className="border-b border-border px-3 py-2.5 font-mono text-[11px] text-muted">#{s.id}</td>
                        <td className="border-b border-border px-3 py-2.5">
                          <Link
                            href={`/results/${s.id}`}
                            className="block max-w-[280px] truncate font-mono text-[11px] text-ink transition-colors hover:text-accent-2"
                          >
                            {s.name || truncate(s.original_prompt, 70)}
                          </Link>
                        </td>
                        <td className="border-b border-border px-3 py-2.5 font-mono text-[11px] text-muted">
                          {formatDate(s.created_at)}
                        </td>
                        <td className="border-b border-border px-3 py-2.5 text-center font-mono text-[11px] text-ink">
                          {s.iteration_count}
                        </td>
                        <td className={`border-b border-border px-3 py-2.5 font-mono text-[11px] ${scoreTextClass(s.first_score)}`}>
                          {formatScore(s.first_score)}
                        </td>
                        <td className={`border-b border-border px-3 py-2.5 font-mono text-[11px] ${scoreTextClass(s.latest_score)}`}>
                          {formatScore(s.latest_score)}
                        </td>
                        <td className={`border-b border-border px-3 py-2.5 font-mono text-[11px] ${d.className}`}>{d.text}</td>
                        <td className="border-b border-border px-3 py-2.5">
                          <Pill status={status} />
                        </td>
                        <td className="border-b border-border px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/results/${s.id}`}>
                              <Button variant="ghost" size="sm">
                                View
                              </Button>
                            </Link>
                            <a href={api.exportCsvUrl(s.id)}>
                              <Button variant="ghost" size="sm">
                                Export
                              </Button>
                            </a>
                            <Button variant="ghost" size="sm" onClick={() => handleRename(s)} disabled={busyId === s.id}>
                              Rename
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(s)} disabled={busyId === s.id}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </ScreenBody>
    </>
  );
}
