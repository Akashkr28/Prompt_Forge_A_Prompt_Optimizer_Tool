"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IterBadge } from "@/components/ui/pill";
import { ScreenHeader, ScreenBody } from "@/components/ui/screen-header";
import { api, streamOptimize, type Config, type OptimizeEvent, type Preset } from "@/lib/api";
import { formatScore, scoreTextClass } from "@/lib/format";

const DEFAULT_PROMPT =
  "Summarize the following article in bullet points. Make sure to include the main ideas and keep it brief. The article is: {article_text}";

const SUBSTEP_LABELS: Record<string, string> = {
  iteration_start: "Running prompt samples…",
  outputs: "Evaluating outputs…",
  scores: "Rewriting via meta-prompt…",
  rewritten: "Saving iteration…",
};

const SUBSTEP_PROGRESS: Record<string, number> = {
  iteration_start: 0.05,
  outputs: 0.4,
  scores: 0.7,
  rewritten: 0.9,
};

type LiveRow = { iteration: number; label: string; score: number | null; status: "running" | "done" };

/**
 * The default screen — `screen-optimizer` in the mockup. Configure a prompt,
 * kick off a run, and watch a live SSE log fill in iteration-by-iteration
 * exactly like the mockup's `startOptimize()` simulation, except every event
 * here is a real model call streamed straight from `/api/optimize`.
 */
export default function OptimizerPage() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [nIterations, setNIterations] = useState(5);
  const [nSamples, setNSamples] = useState(3);

  const [running, setRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressSub, setProgressSub] = useState("");
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.config(), api.presets()])
      .then(([c, p]) => {
        if (cancelled) return;
        setConfig(c);
        setPresets(p);
        setNIterations(c.n_iterations);
        setNSamples(c.n_samples);
      })
      .catch(() => {
        /* the action bar disables itself when config never loads */
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  async function handleRun() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setError(null);
    setLiveRows([]);
    setProgressPct(0);
    setProgressLabel("Starting…");
    setProgressSub(`Iteration 1 of ${nIterations}`);

    const controller = new AbortController();
    abortRef.current = controller;
    let sessionId: number | null = null;

    const handleEvent = (event: OptimizeEvent) => {
      switch (event.type) {
        case "session_created":
          sessionId = event.session_id;
          break;
        case "iteration_start":
        case "outputs":
        case "scores":
        case "rewritten": {
          const frac = SUBSTEP_PROGRESS[event.type] ?? 0;
          setProgressPct(Math.round(((event.iteration - 1 + frac) / nIterations) * 100));
          setProgressLabel(SUBSTEP_LABELS[event.type]);
          setProgressSub(`Iteration ${event.iteration} of ${nIterations}`);
          setLiveRows((rows) =>
            rows.some((r) => r.iteration === event.iteration)
              ? rows
              : [...rows, { iteration: event.iteration, label: "Working…", score: null, status: "running" }],
          );
          break;
        }
        case "iteration_complete":
          setProgressPct(Math.round((event.iteration / nIterations) * 100));
          setLiveRows((rows) => [
            ...rows.filter((r) => r.iteration !== event.iteration),
            {
              iteration: event.iteration,
              label: `Prompt v${event.iteration} generated`,
              score: event.record.avg_total,
              status: "done",
            },
          ]);
          break;
        case "done":
          setProgressPct(100);
          setProgressLabel("Complete!");
          setProgressSub(`Done — ${nIterations} iterations`);
          if (sessionId !== null) {
            const id = sessionId;
            setTimeout(() => router.push(`/results/${id}`), 700);
          }
          break;
        case "error":
          setError(event.message);
          break;
      }
    };

    try {
      for await (const event of streamOptimize(
        { prompt, n_iterations: nIterations, n_samples: nSamples },
        controller.signal,
      )) {
        handleEvent(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setRunning(false);
    setProgressLabel("Stopped");
  }

  function handleClear() {
    if (running) handleStop();
    setPrompt("");
    setLiveRows([]);
    setProgressPct(0);
    setError(null);
  }

  function handleLoadPreset() {
    if (!presets.length) return;
    const preset = presets[Math.floor(Math.random() * presets.length)];
    setPrompt(preset.prompt);
  }

  const estCost = (nIterations * nSamples * 0.0009 + nIterations * 0.0016).toFixed(2);
  const estSeconds = nIterations * (8 + nSamples * 2);
  const canRun = Boolean(prompt.trim()) && !running && (config?.api_key_configured ?? true);

  return (
    <>
      <ScreenHeader
        eyebrow="Workspace · Optimizer"
        title="Prompt Optimizer"
        sub="Enter a prompt, configure iterations, and watch the meta-prompting loop improve it automatically."
      />
      <ScreenBody>
        {/* Input card */}
        <Card>
          <CardHead dotColor="var(--color-accent)" title="Input Prompt" sub="Paste any task prompt to optimize" />
          <CardBody className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink">Original Prompt</label>
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Summarize the following article in 3 bullet points…"
                className="w-full resize-y rounded-md border border-border bg-paper px-3 py-2.5 font-mono text-xs text-ink outline-none transition-colors focus:border-accent-2"
              />
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <RangeField label="Iterations" min={1} max={10} value={nIterations} onChange={setNIterations} />
              <RangeField label="Samples per Iteration" min={1} max={5} value={nSamples} onChange={setNSamples} />
            </div>
          </CardBody>
        </Card>

        {/* Config strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ConfigTile label="Eval Model" value={config?.evaluator_model ?? "—"} />
          <ConfigTile label="Optimizer Model" value={config?.optimizer_model ?? "—"} />
          <ConfigTile label="Scoring" value={(config?.dimensions ?? []).map(capitalize).join(" · ") || "—"} />
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {running ? (
            <Button variant="ghost" onClick={handleStop}>
              <StopIcon /> Stop
            </Button>
          ) : (
            <Button variant="accent" onClick={handleRun} disabled={!canRun}>
              <PlayIcon /> Run Optimization
            </Button>
          )}
          <Button variant="ghost" onClick={handleLoadPreset} disabled={!presets.length}>
            Load Preset
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={running && liveRows.length === 0}>
            Clear
          </Button>
          <div className="ml-auto font-mono text-[11px] text-muted">
            Est. cost: ~${estCost} · ~{estSeconds}s
          </div>
        </div>

        {config && !config.api_key_configured && (
          <p className="-mt-3 font-mono text-[11px] text-accent">
            ANTHROPIC_API_KEY isn&apos;t configured on the server — set it and restart the API to run optimizations.
          </p>
        )}
        {error && <p className="-mt-3 font-mono text-[11px] text-accent">{error}</p>}

        {/* Progress card */}
        {(running || liveRows.length > 0) && (
          <Card>
            <CardHead>
              <SpinIcon spinning={running} />
              <span className="text-xs font-semibold tracking-wide text-ink">
                {running ? "Optimizing…" : "Run finished"}
              </span>
              <span className="ml-auto text-[11px] text-muted">{progressSub}</span>
            </CardHead>
            <CardBody className="flex flex-col gap-3.5">
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className="font-mono text-[11px] text-muted">{progressLabel}</span>
                  <span className="font-mono text-[11px] text-ink">{progressPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-cream">
                  <div
                    className="h-full rounded-[3px] bg-accent-2 transition-[width] duration-400 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <div className="flex max-h-[220px] flex-col overflow-y-auto">
                {liveRows.map((row) => (
                  <div
                    key={row.iteration}
                    className="grid animate-fadein grid-cols-[40px_1fr_90px_90px] items-center gap-3 border-b border-border py-2.5 last:border-none"
                  >
                    <div className="text-center font-mono text-[11px] text-muted">
                      {String(row.iteration).padStart(2, "0")}
                    </div>
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted">
                      {row.label}
                    </div>
                    <div className={`font-mono text-xs font-medium ${scoreTextClass(row.score)}`}>
                      {row.score === null ? "—" : `${formatScore(row.score)} / 10`}
                    </div>
                    <div>
                      <IterBadge kind={row.status === "done" ? "done" : "running"} />
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </ScreenBody>
    </>
  );
}

function RangeField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-ink">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-accent"
        />
        <span className="min-w-[20px] text-center font-mono text-[13px] font-medium text-accent">{value}</span>
      </div>
    </div>
  );
}

function ConfigTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="px-3.5 py-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{label}</div>
        <div className="text-xs text-ink">{value}</div>
      </CardBody>
    </Card>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zm0 2v3.586l2.207 2.207-1.414 1.414L6.586 9.586A1 1 0 016.293 9V5h1.5z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function SpinIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--color-accent-2)"
      strokeWidth={2}
      className={spinning ? "animate-spin" : ""}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" strokeDasharray="25 13" />
    </svg>
  );
}
