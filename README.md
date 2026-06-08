# Automated Prompt Optimizer

A self-improving prompt engine that uses **meta-prompting** and **LLM-as-evaluator** to
iteratively optimize any task prompt. Given a starting prompt, the system runs it several times,
scores the outputs across four rubric dimensions with a judge model, rewrites the prompt using
those scores as feedback, and repeats — producing a **score-improvement curve** you can watch
grow live or browse afterwards.

## Architecture

Three LLM roles interact in a loop. Each iteration produces scored outputs and a rewritten
prompt that feeds the next round; everything is persisted so the curve survives the run.

```
USER INPUT  (original prompt)
   |
   v
RUNNER LLM        --  executes the current prompt N times (sampled concurrently)
   |
   v
EVALUATOR LLM     --  judges each output on accuracy / clarity / completeness / conciseness (JSON)
   |
   v
OPTIMIZER LLM     --  meta-prompt: reads the prompt + outputs + scores, rewrites the prompt
   |
   v
SQLITE HISTORY    --  every iteration's prompt, scores, critiques, and outputs
   |
   v
DASHBOARD         --  live run view + score curves, prompt diffs, session comparison
```

### Two ways to run it

The optimization engine (`optimizer/`) is a single shared package with three front ends layered
on top of it — pick whichever fits:

| Front end | Stack | Best for |
|---|---|---|
| **PromptForge** (`server/` + `web/`) | FastAPI (REST + SSE) + Next.js | The primary, polished dashboard — live-streamed runs, score curves, prompt diffs, session history, all in a custom-designed UI. **Recommended.** |
| **Streamlit dashboard** (`dashboard/`) | Streamlit + Plotly | A lightweight, zero-frontend-build alternative — same core views (new run + history/compare), one Python process, deploys to Streamlit Community Cloud. |
| **CLI** (`optimize.py`) | argparse | Scripting, automation, CI, or just watching the loop in a terminal. |

All three share the exact same `optimizer/` engine and the same SQLite history file — a session
started from one shows up in the others.

### Why these design choices

- **Multiple samples per iteration** — a single run is noisy; averaging several samples gives
  the optimizer a stable signal before it rewrites anything.
- **A separate evaluator model** — self-evaluation is biased. Using a distinct model for judging
  mirrors real eval practice (and here, a cheaper/faster one, since it's the highest-volume role).
- **Structured JSON scoring** — four independent dimensions (not just one number) so each can be
  charted on its own and the optimizer gets specific, actionable feedback.
- **Persisted history** — the improvement curve *is* the artifact. SQLite keeps every run
  queryable from both the CLI and the dashboard with zero setup.
- **A generator-based pipeline** — `optimize_prompt()` yields progress events as it runs, so the
  CLI and the Streamlit dashboard can both show live progress without re-implementing the loop.

## Project layout

```
optimizer/
  config.py       OptimizerConfig — model selection & loop sizing, loaded from .env
  meta_prompt.py  Meta-prompting template that turns scores into a rewritten prompt
  evaluator.py    LLM-as-judge: structured scoring with hardened JSON parsing
  runner.py       Samples a candidate prompt N times concurrently
  pipeline.py     optimize_prompt() — the streaming generator that drives the loop
  storage.py      SQLite-backed session/iteration history + CSV export
server/
  main.py         FastAPI app — REST endpoints + a /api/optimize SSE stream over the engine
web/
  src/app/        Next.js (App Router) pages: optimizer, results, history, settings
  src/components/ PromptForge design-system components (cards, tabs, score chart, diff view…)
  src/lib/        Typed API client (incl. the SSE consumer), formatting & word-diff helpers
dashboard/
  app.py          Streamlit UI: live runs + history/compare (lightweight alternative front end)
presets/
  challenges.json Five starter prompts (summarization, classification, Q&A, codegen, extraction)
tests/            Offline pytest suite (fake Anthropic clients, no API key needed)
optimize.py       CLI entry point
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

Only needed if you want to run **PromptForge** (the Next.js frontend) — the CLI, API, and
Streamlit dashboard need nothing beyond the Python setup above:

```bash
cd web && npm install
```

## Usage

### CLI

```bash
python optimize.py --prompt "Summarize this article in 3 bullets" --iters 5

# Useful flags:
#   --samples 3            samples averaged per iteration (default 3)
#   --name "my-session"    label the run in the history store
#   --export scores.csv    write the per-iteration score table to CSV
#   --runner-model / --optimizer-model / --evaluator-model   override model IDs
```

Each iteration prints its score and delta from the previous round, and is saved to
`optimizer_history.db` (SQLite) as it completes.

### PromptForge (FastAPI + Next.js) — recommended

A two-process app: a FastAPI backend (`server/`) wraps the `optimizer` engine behind a small REST
API and a Server-Sent-Events stream, and a Next.js frontend (`web/`) renders it as a
warm-editorial dashboard — "PromptForge — Automated Prompt Optimizer".

```bash
# Terminal 1 — API on :8000 (serves REST + SSE; reads the same .env as the CLI)
.venv/bin/uvicorn server.main:app --reload --port 8000

# Terminal 2 — frontend on :3000 (proxies API calls to :8000 in dev)
cd web && npm install && npm run dev
```

Then open **http://localhost:3000**:

- **Prompt Optimizer** (`/`) — write or paste a prompt, tune iterations/samples with live cost &
  time estimates, and hit *Run Optimization* to watch progress stream in over SSE in real time —
  per-iteration sampling, judging, and rewriting — before landing on that run's results.
- **Results & Analysis** (`/results`, `/results/[id]`) — a custom-built SVG score-improvement
  curve, a clickable iteration log, and a tabbed detail panel: word-level **prompt diff**
  (original vs. any iteration), **per-dimension eval scores** with the optimizer's critique, and
  every **sample output** with its individual judge score.
- **Session History** (`/history`) — a searchable, sortable table of every run with start/final
  scores and deltas, plus per-row view / CSV export / rename / delete actions.
- **Settings** (`/settings`) — a live read-only view of the server's model, evaluation, and
  storage configuration (so it can never drift from the single `.env`-driven source of truth
  shared with the CLI and the Streamlit dashboard).

The `server/` and `web/` apps share the exact same `optimizer` engine, `OptimizerConfig`, and
SQLite history file as the CLI and the Streamlit dashboard below — runs started from any of them
show up in all the others.

### Streamlit dashboard (lightweight alternative)

```bash
streamlit run dashboard/app.py
```

A single-process, zero-frontend-build alternative with the same core views:

- **New Run** — start from one of five preset challenges or write your own prompt, watch a live
  iteration log and score curve as the loop runs, then see an original-vs-optimized diff.
- **History** — browse past sessions, chart their score curves (total + each rubric dimension),
  diff the original prompt against the final one, drill into per-iteration critiques and sample
  outputs, export scores to CSV, and overlay multiple sessions to compare runs.

## Configuration

All knobs live in `.env` (see `.env.example`) and can be overridden per-run via CLI flags or the
dashboard's sliders:

| Setting | Default | Notes |
|---|---|---|
| `OPTIMIZER_RUNNER_MODEL` | `claude-sonnet-4-6` | Executes the candidate prompt |
| `OPTIMIZER_OPTIMIZER_MODEL` | `claude-sonnet-4-6` | Rewrites the prompt via the meta-prompt |
| `OPTIMIZER_EVALUATOR_MODEL` | `claude-haiku-4-5-20251001` | Judges outputs (highest call volume — cheaper model by default) |
| `OPTIMIZER_N_SAMPLES` | `3` | Outputs sampled per iteration |
| `OPTIMIZER_N_ITERATIONS` | `5` | Optimization rounds |
| `OPTIMIZER_DB_PATH` | `optimizer_history.db` | SQLite history file |

## Testing

```bash
pytest
```

The full suite runs **offline** — every module is exercised against fake/scripted Anthropic
clients, so no API key or network access is required to verify correctness.

## Deploying

### PromptForge (FastAPI + Next.js)

Two stateless processes over one SQLite file:

1. **API** — run `uvicorn server.main:app --host 0.0.0.0 --port 8000` anywhere that can hold
   `ANTHROPIC_API_KEY` and the `OPTIMIZER_DB_PATH` SQLite file (Fly.io, Render, a VM, etc.).
2. **Frontend** — `cd web && npm run build && npm start`, or deploy to **Vercel**; point
   `NEXT_PUBLIC_API_BASE` (see `web/src/lib/api.ts`) at your API's public URL and make sure its
   CORS `allow_origins` (in `server/main.py`) includes the frontend's deployed origin.

### Streamlit dashboard (legacy/lightweight)

A stateless Streamlit app over the same SQLite file, so it deploys cleanly to
**Streamlit Community Cloud**:

1. Push this repo to GitHub.
2. On [share.streamlit.io](https://share.streamlit.io), create a new app pointing at
   `dashboard/app.py`.
3. In the app's **Secrets**, add `ANTHROPIC_API_KEY = "sk-ant-..."` (and any model overrides you
   want from the table above).

Locally or on any other host, `streamlit run dashboard/app.py` with `.env` populated is enough —
no database server or extra infrastructure required.
