"use client";

import { useEffect, useState } from "react";
import { Card, CardHead, CardBody } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { ScreenHeader, ScreenBody } from "@/components/ui/screen-header";
import { api, type Config, type Stats } from "@/lib/api";

/**
 * `screen-settings`. The mockup's version has editable selects and toggles,
 * but PromptForge's models, dimensions, and storage are intentionally driven
 * by environment variables — one source of truth shared by the CLI, the
 * legacy Streamlit dashboard, and this API — so changing them here would
 * either silently do nothing or fork that contract. This screen shows the
 * live configuration instead, with a pointer to where it actually lives.
 */
export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.config(), api.stats()])
      .then(([c, s]) => {
        if (!cancelled) {
          setConfig(c);
          setStats(s);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ScreenHeader
        eyebrow="Configuration"
        title="Settings"
        sub="Live model, evaluation, and storage configuration — sourced from the API server's environment."
      />
      <ScreenBody>
        <Card>
          <CardHead title="Model Configuration" />
          <CardBody className="flex flex-col gap-0">
            <SettingRow
              title="Runner model"
              desc="Executes the prompt being optimized to produce sample outputs for judging."
              env="OPTIMIZER_RUNNER_MODEL"
              value={config?.runner_model}
            />
            <SettingRow
              title="Optimizer model"
              desc="Rewrites the prompt via the meta-prompt each iteration. More capable usually means better rewrites at higher cost."
              env="OPTIMIZER_OPTIMIZER_MODEL"
              value={config?.optimizer_model}
            />
            <SettingRow
              title="Evaluator model"
              desc="Acts as judge — scores every sample output across four dimensions (0–10), fast and cheap by design."
              env="OPTIMIZER_EVALUATOR_MODEL"
              value={config?.evaluator_model}
            />
            <SettingRow
              title="Default iterations"
              desc="How many optimization rounds a new run uses unless overridden from the Optimizer screen."
              env="OPTIMIZER_N_ITERATIONS"
              value={config ? String(config.n_iterations) : undefined}
            />
            <SettingRow
              title="Default samples per iteration"
              desc="How many independent outputs are generated — and judged — per iteration unless overridden."
              env="OPTIMIZER_N_SAMPLES"
              value={config ? String(config.n_samples) : undefined}
            />
            <SettingRow
              title="API key"
              desc="Required for every run — the Optimizer screen disables itself until this is set."
              env="ANTHROPIC_API_KEY"
              value={
                config ? (
                  <span className={`font-mono text-xs ${config.api_key_configured ? "text-green" : "text-accent"}`}>
                    {config.api_key_configured ? "configured" : "missing"}
                  </span>
                ) : undefined
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Evaluation Dimensions" sub="Scored 0–10 per sample output, then averaged across the run" />
          <CardBody className="flex flex-col gap-0">
            {(config?.dimensions ?? ["accuracy", "clarity", "completeness", "conciseness"]).map((dim) => (
              <SettingRow
                key={dim}
                title={capitalize(dim)}
                desc={`Included in every evaluation — judged by ${config?.evaluator_model ?? "the evaluator model"} on a 0–10 scale.`}
                value={<Toggle checked disabled label={`${dim} enabled`} />}
              />
            ))}
            <p className="pt-3 font-mono text-[11px] leading-relaxed text-muted">
              The rubric is shared code (<code className="text-ink">optimizer/evaluator.py</code>), so every front end —
              CLI, dashboard, and this app — scores runs identically. Adding a custom dimension means extending that
              rubric, not toggling a switch here.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Storage & Export" />
          <CardBody className="flex flex-col gap-0">
            <SettingRow
              title="Auto-save runs to SQLite"
              desc="Every completed iteration is persisted as it lands — this is what powers Results & Session History."
              env="OPTIMIZER_DB_PATH"
              value={<Toggle checked disabled label="auto-save enabled" />}
            />
            <SettingRow
              title="Recorded so far"
              desc="Total activity persisted to the database across every session."
              value={
                stats ? (
                  <span className="font-mono text-xs text-ink">
                    {stats.session_count} session{stats.session_count === 1 ? "" : "s"} · {stats.iteration_count} iteration
                    {stats.iteration_count === 1 ? "" : "s"}
                  </span>
                ) : undefined
              }
            />
            <SettingRow
              title="CSV export"
              desc="Download a per-session CSV of iteration scores from any row in Session History."
              value={<span className="font-mono text-xs text-muted">available per session</span>}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="font-mono text-[11px] leading-relaxed text-muted">
              These values come straight from the API server&apos;s environment (loaded once at startup via{" "}
              <code className="text-ink">OptimizerConfig.from_env()</code>) so the CLI, the legacy Streamlit dashboard, and
              this app can never drift out of sync. To change a model or default, edit your <code className="text-ink">.env</code>{" "}
              file (see <code className="text-ink">.env.example</code>) and restart the API server with{" "}
              <code className="text-ink">uvicorn server.main:app --reload</code>.
            </p>
          </CardBody>
        </Card>
      </ScreenBody>
    </>
  );
}

function SettingRow({
  title,
  desc,
  value,
  env,
}: {
  title: string;
  desc: string;
  value?: React.ReactNode;
  env?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-3.5 last:border-none">
      <div className="flex-1">
        <div className="mb-0.5 text-[13px] font-medium text-ink">{title}</div>
        <div className="text-[11px] leading-relaxed text-muted">
          {desc}
          {env && <span className="ml-1.5 font-mono text-[10px] text-warm">· {env}</span>}
        </div>
      </div>
      <div className="flex-shrink-0">{value ?? <span className="font-mono text-xs text-muted">—</span>}</div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
