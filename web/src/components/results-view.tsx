"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardHead, CardBody } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { ScoreBar } from "@/components/ui/bar";
import { IterBadge } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ScreenBody } from "@/components/ui/screen-header";
import { api, type Dimensions, type Iteration, type RawScore, type SessionDetail } from "@/lib/api";
import { formatDelta, formatScore, scoreTextClass, truncate } from "@/lib/format";
import { diffWords, type DiffPart } from "@/lib/diff";

const DIMENSIONS: { key: keyof Dimensions; label: string }[] = [
  { key: "accuracy", label: "Accuracy" },
  { key: "clarity", label: "Clarity" },
  { key: "completeness", label: "Completeness" },
  { key: "conciseness", label: "Conciseness" },
];

/**
 * `screen-results` — score curve, iteration log, and a tabbed detail panel
 * (diff / eval / outputs). Used both for `/results` (latest run) and
 * `/results/[id]` (a specific session) so the View links from History land
 * on identical UI to the page a fresh run redirects to.
 */
export function ResultsView({ sessionId }: { sessionId?: number }) {
  const [session, setSession] = useState<SessionDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [selectedIter, setSelectedIter] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSession(undefined);
    setError(null);
    setSelectedIter(null);

    (async () => {
      try {
        let id = sessionId;
        if (id === undefined) {
          const sessions = await api.sessions();
          if (!sessions.length) {
            if (!cancelled) setSession(null);
            return;
          }
          id = sessions[0].id; // most-recent-first from the API
        }
        const detail = await api.session(id);
        if (cancelled) return;
        setSession(detail);
        setSelectedIter(detail.iterations.at(-1)?.iteration ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSession(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (session === undefined) {
    return (
      <ScreenBody>
        <p className="font-mono text-xs text-muted">Loading results…</p>
      </ScreenBody>
    );
  }

  if (error) {
    return (
      <ScreenBody>
        <EmptyState
          icon="✕"
          title="Couldn't load this session"
          sub={error}
          action={
            <Link href="/history">
              <Button variant="ghost" size="sm" className="mt-1">
                Back to history
              </Button>
            </Link>
          }
        />
      </ScreenBody>
    );
  }

  if (!session || session.iterations.length === 0) {
    return (
      <ScreenBody>
        <EmptyState
          icon="◌"
          title="No runs yet"
          sub="Start an optimization to see score curves, prompt diffs, and per-dimension evaluations here."
          action={
            <Link href="/">
              <Button variant="accent" size="sm" className="mt-1">
                Go to Optimizer
              </Button>
            </Link>
          }
        />
      </ScreenBody>
    );
  }

  const iterations = session.iterations;
  const first = iterations[0];
  const latest = iterations[iterations.length - 1];
  const best = iterations.reduce((b, it) => (it.avg_total > b.avg_total ? it : b), first);
  const delta = formatDelta(latest.avg_total - first.avg_total);
  const selected = iterations.find((it) => it.iteration === selectedIter) ?? latest;

  return (
    <ScreenBody>
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          value={delta.text}
          label="Score improvement"
          color={delta.text.startsWith("+") ? "var(--color-green)" : delta.text.startsWith("-") ? "var(--color-accent)" : undefined}
        />
        <StatTile value={formatScore(latest.avg_total)} label="Final avg score / 10" />
        <StatTile value={String(iterations.length)} label="Iterations run" color="var(--color-accent-2)" />
        <StatTile value={formatScore(best.avg_total)} label="Best score / 10" color="var(--color-green)" />
      </div>

      {/* Score chart */}
      <Card>
        <CardHead dotColor="var(--color-accent-2)" dotShape="square" title="Score Improvement Curve" sub="avg total score per iteration" />
        <CardBody>
          <div className="h-[180px]">
            <ScoreChart iterations={iterations} />
          </div>
        </CardBody>
      </Card>

      {/* Iteration table */}
      <Card>
        <CardHead dotColor="var(--color-gold)" dotShape="square" title="Iteration Log" sub="Click a row to inspect" />
        <div className="flex flex-col">
          {iterations.map((it, idx) => {
            const prevScore = idx > 0 ? iterations[idx - 1].avg_total : null;
            const rowDelta = formatDelta(prevScore === null ? null : it.avg_total - prevScore);
            const isSelected = selected.iteration === it.iteration;
            const isBest = it.id === best.id;
            const isLatest = it.iteration === latest.iteration;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedIter(it.iteration)}
                className={`grid grid-cols-[40px_1fr_90px_70px_64px] items-center gap-3 border-b border-border px-3.5 py-2.5 text-left transition-colors last:border-none hover:bg-cream ${
                  isSelected ? "border-l-2 border-l-accent-2 bg-[#f0f4ff]" : ""
                }`}
              >
                <div className="text-center font-mono text-[11px] text-muted">{String(it.iteration).padStart(2, "0")}</div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-ink">
                  {truncate(it.prompt, 110)}
                </div>
                <div className={`font-mono text-xs font-medium ${scoreTextClass(it.avg_total)}`}>
                  {formatScore(it.avg_total)} / 10
                </div>
                <div className={`font-mono text-[11px] ${rowDelta.className}`}>{rowDelta.text}</div>
                <div>
                  {isBest ? <IterBadge kind="best" /> : isLatest ? <IterBadge kind="latest" /> : <IterBadge kind="done" />}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Detail panel */}
      <Card>
        <Tabs
          tabs={[
            {
              id: "diff",
              label: "Prompt Diff",
              content: <DiffPanel original={session.original_prompt} selected={selected} isBest={selected.id === best.id} />,
            },
            { id: "eval", label: "Eval Scores", content: <EvalPanel iteration={selected} /> },
            { id: "output", label: "Sample Outputs", content: <OutputPanel iteration={selected} /> },
          ]}
        />
      </Card>
    </ScreenBody>
  );
}

// ─── Score chart ────────────────────────────────────────────────────────────

function ScoreChart({ iterations }: { iterations: Iteration[] }) {
  const width = 560;
  const height = 160;
  const padTop = 22;
  const padBottom = 30;
  const padLeft = 30;
  const padRight = 16;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const minScore = 0;
  const maxScore = 10;

  const xFor = (i: number) => (iterations.length > 1 ? padLeft + (i / (iterations.length - 1)) * plotW : padLeft + plotW / 2);
  const yFor = (score: number) => padTop + (1 - (score - minScore) / (maxScore - minScore)) * plotH;

  const points = iterations.map((it, i) => ({ x: xFor(i), y: yFor(it.avg_total), score: it.avg_total, n: it.iteration }));
  const linePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")} L ${points[points.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L ${points[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : "";
  const gridScores = [10, 7.5, 5, 2.5];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="resultsAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a6fc8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2a6fc8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridScores.map((s) => (
        <line key={`grid-${s}`} x1={padLeft} y1={yFor(s)} x2={width - padRight} y2={yFor(s)} stroke="#e8e2d8" strokeWidth={0.5} />
      ))}
      {gridScores.map((s) => (
        <text key={`lbl-${s}`} x={2} y={yFor(s) + 3} fontFamily="DM Mono, monospace" fontSize={9} fill="#9a9080">
          {s}
        </text>
      ))}
      {areaPath && <path d={areaPath} fill="url(#resultsAreaGrad)" />}
      {points.length > 1 && (
        <polyline points={linePoints} fill="none" stroke="#2a6fc8" strokeWidth={2} strokeLinejoin="round" />
      )}
      {points.map((p, i) => (
        <circle
          key={`pt-${p.n}`}
          cx={p.x}
          cy={p.y}
          r={5}
          fill={i === points.length - 1 ? "#2a6fc8" : "#fff"}
          stroke="#2a6fc8"
          strokeWidth={2}
        />
      ))}
      {points.map((p) => (
        <text key={`x-${p.n}`} x={p.x} y={height - 6} fontFamily="DM Mono, monospace" fontSize={9} fill="#9a9080" textAnchor="middle">
          Iter {p.n}
        </text>
      ))}
      {points.map((p) => (
        <text key={`s-${p.n}`} x={p.x} y={Math.max(p.y - 9, 12)} fontFamily="DM Mono, monospace" fontSize={9} fill="#2a6fc8" textAnchor="middle">
          {p.score.toFixed(1)}
        </text>
      ))}
    </svg>
  );
}

// ─── Diff panel ─────────────────────────────────────────────────────────────

function DiffPanel({ original, selected, isBest }: { original: string; selected: Iteration; isBest: boolean }) {
  const { before, after } = useMemo(() => diffWords(original, selected.prompt), [original, selected.prompt]);
  const isOriginal = selected.prompt === original;

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      <div>
        <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Before (original)</div>
        <DiffBox parts={before} mode="removed" />
      </div>
      <div>
        <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          After (Iter {selected.iteration}) {isBest && "✦ best"}
        </div>
        {isOriginal ? (
          <DiffBox parts={[{ value: selected.prompt }]} mode="added" />
        ) : (
          <DiffBox parts={after} mode="added" />
        )}
      </div>
    </div>
  );
}

function DiffBox({ parts, mode }: { parts: DiffPart[]; mode: "removed" | "added" }) {
  return (
    <div className="min-h-[120px] whitespace-pre-wrap rounded-md border border-border bg-paper p-3 font-mono text-[11px] leading-[1.7] text-ink">
      {parts.map((part, i) => {
        const highlight = mode === "removed" ? part.removed : part.added;
        if (!highlight) return <span key={i}>{part.value}</span>;
        const cls =
          mode === "removed"
            ? "rounded-[2px] bg-[#fde8e4] px-[2px] text-[#a02020]"
            : "rounded-[2px] bg-[#e4fde8] px-[2px] text-[#1a7a40]";
        return (
          <span key={i} className={cls}>
            {part.value}
          </span>
        );
      })}
    </div>
  );
}

// ─── Eval panel ─────────────────────────────────────────────────────────────

function EvalPanel({ iteration }: { iteration: Iteration }) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DIMENSIONS.map(({ key, label }) => {
          const value = iteration.avg_dimensions?.[key];
          return (
            <div key={key} className="rounded-md border border-border bg-paper p-3.5">
              <div className="mb-2 text-[11px] font-semibold text-ink">{label}</div>
              <div className="flex items-center gap-2.5">
                <div className="min-w-[36px] font-mono text-lg font-medium text-ink">
                  {value !== undefined && value !== null ? value.toFixed(1) : "—"}
                </div>
                <ScoreBar value={value ?? 0} color="var(--color-accent-2)" height={5} />
              </div>
            </div>
          );
        })}
      </div>
      {iteration.critique && (
        <div className="mt-3.5">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Optimizer critique</div>
          <div className="rounded-r-md border-l-[3px] border-gold bg-cream px-3.5 py-3 font-mono text-[11px] leading-[1.65] text-ink">
            {iteration.critique}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Output panel ───────────────────────────────────────────────────────────

function sampleScore(scores: RawScore[] | undefined, index: number): RawScore | undefined {
  return scores?.[index];
}

function OutputPanel({ iteration }: { iteration: Iteration }) {
  if (!iteration.outputs?.length) {
    return <p className="font-mono text-xs text-muted">No sample outputs were recorded for this iteration.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {iteration.outputs.map((output, i) => {
        const score = sampleScore(iteration.raw_scores, i);
        return (
          <div key={i}>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              <span>Sample {String.fromCharCode(65 + i)}</span>
              {score?.total !== undefined && (
                <span className={scoreTextClass(score.total)}>— score {score.total.toFixed(1)}</span>
              )}
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-border bg-paper p-3 font-mono text-[11px] leading-[1.7] text-ink">
              {output}
            </div>
            {score?.critique && <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">{score.critique}</div>}
          </div>
        );
      })}
    </div>
  );
}
