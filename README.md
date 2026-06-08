# 🔁 PromptForge — Automated Prompt Optimizer

**Turn a rough prompt into a sharp one — automatically.**

A self-improving prompt engine that uses **meta-prompting** and **LLM-as-judge** evaluation to
iteratively rewrite and improve any task prompt — then shows you exactly *how*, *why*, and *by
how much* it got better, with live score curves, word-level diffs, and full session history.

---

## Table of contents

- [What is this?](#what-is-this)
- [How it works](#how-it-works)
- [Features](#features)
- [Where you'd use it](#where-youd-use-it)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design notes / FAQ](#design-notes--faq)
- [License](#license)

---

## What is this?

Writing a genuinely *good* prompt for an LLM is mostly trial and error — you tweak the wording,
run it a few times, eyeball the results, and guess whether it actually got better. **PromptForge
automates that loop** and replaces guesswork with measurement:

1. **You give it a starting prompt** — e.g. *"Summarize this article in 3 bullets."*
2. **It runs that prompt** through an LLM several times (to smooth out randomness between runs).
3. **A second LLM grades every output** like a teacher — scoring accuracy, clarity, completeness,
   and conciseness from 0–10 each, plus a written critique explaining the score.
4. **A third LLM rewrites the prompt** — using the original prompt, the outputs it produced, the
   scores, and the critique as feedback — to produce a clearer, more effective version.
5. **Repeat.** The new prompt goes through the exact same cycle again, for as many rounds as you
   like, each one building on the last.

At the end you get a **score-improvement curve**, a **word-level diff** of the original vs.
optimized prompt, and the **reasoning** behind every change — so you don't just walk away with a
"better" prompt, you understand *why* it's better and can apply that insight elsewhere.

---

## How it works

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
SQLITE HISTORY    --  every iteration's prompt, scores, critiques, and outputs persisted
   |
   v
DASHBOARD         --  live run view + score curves, prompt diffs, session history
```

---

## Features

- 🔄 **Fully automated optimization loop** — point it at a prompt and let it run N iterations unattended
- 🧪 **LLM-as-judge evaluation** — structured 0–10 scoring across four independent rubric
  dimensions (not just one number), plus a written critique for every output
- 📈 **Live score-improvement curves** — watch quality climb in real time as each iteration completes
- 🔍 **Word-level prompt diffs** — see precisely what changed between the original prompt and any
  iteration, with additions and removals highlighted
- 📜 **Full session history** — every run is saved; browse, search, rename, delete, re-open, or
  export any of them later
- 📤 **CSV export** — pull per-iteration scores out for your own analysis
- ⚡ **Live streaming progress** — the PromptForge dashboard streams each step (sampling →
  judging → rewriting) over Server-Sent-Events as it happens — no polling, no page refreshes
- 🧩 **Three interchangeable front ends** — a polished Next.js dashboard, a lightweight Streamlit
  dashboard, and a scriptable CLI — all sharing one engine, one config, and one database
- 🎯 **Five ready-made preset challenges** — summarization, classification, Q&A, code generation,
  and structured-data extraction, so you can try the loop immediately without writing your own prompt
- 🧵 **Concurrent sampling & judging** — multiple outputs are generated and scored in parallel via
  a thread pool, so a 3-sample iteration doesn't take 3× as long
- 🛡️ **Hardened JSON parsing** — the judge's structured output survives markdown fences,
  formatting quirks, and even outright malformed responses (with a retry and a safe neutral
  fallback), so one bad judge response can't crash an entire run
- ⚙️ **Single source of truth for configuration** — every front end (CLI, API, both dashboards)
  reads the exact same `.env`-driven `OptimizerConfig`, so they can never drift out of sync

---

## Where you'd use it

- **Before shipping an AI feature** — find a measurably better prompt before hardcoding it into
  your product (chatbot replies, summarizers, classifiers, extractors, support-ticket triage, etc.)
- **As a prompt-engineering lab** — stop guessing whether a wording tweak helped; get a score and
  a curve instead of a feeling
- **To standardize prompts across a team** — turn "whose prompt is better?" into a data-backed,
  reproducible comparison
- **As a learning tool** — read the optimizer's own critiques to understand *what* makes a prompt
  weak and *how* to fix it
- **For quick experimentation** — try the five built-in presets (summarization, classification,
  Q&A, code generation, structured extraction) to see the whole loop in action immediately,
  with no setup beyond an API key

---

## Tech stack

| Layer | Technology |
|---|---|
| **LLM provider** | [Anthropic Claude](https://www.anthropic.com/) (`claude-sonnet-4-6` for running & optimizing, `claude-haiku-4-5-20251001` for evaluation by default — fully configurable) |
| **Optimization engine** | Python · `anthropic` SDK · `concurrent.futures` for parallel sampling & judging |
| **Storage** | SQLite (stdlib `sqlite3`, no ORM) — one shared history file across every front end |
| **API backend** | [FastAPI](https://fastapi.tiangolo.com/) — REST endpoints + a `/api/optimize` Server-Sent-Events stream |
| **Primary frontend** | [Next.js 16](https://nextjs.org/) (App Router) · React 19 · TypeScript · Tailwind CSS v4 — a custom "PromptForge" design system (Fraunces / DM Mono / Instrument Sans, warm-editorial palette) |
| **Lightweight frontend** | [Streamlit](https://streamlit.io/) + [Plotly](https://plotly.com/python/) |
| **CLI** | stdlib `argparse` |
| **Testing** | `pytest` — runs fully **offline** against fake/scripted Anthropic clients (no API key or network needed) |

---

## Project structure

```
Prompt_Optimizer/
├── optimizer/              # The shared optimization engine — used by every front end
│   ├── config.py             OptimizerConfig — model selection & loop sizing, loaded from .env
│   ├── meta_prompt.py        Meta-prompting template that turns scores into a rewritten prompt
│   ├── evaluator.py          LLM-as-judge: structured scoring with hardened JSON parsing
│   ├── runner.py             Samples a candidate prompt N times concurrently
│   ├── pipeline.py           optimize_prompt() — the streaming generator that drives the loop
│   └── storage.py            SQLite-backed session/iteration history + CSV export
├── server/                 # FastAPI backend (REST + SSE) — powers the PromptForge dashboard
│   └── main.py
├── web/                    # Next.js frontend — the "PromptForge" dashboard (recommended)
│   ├── src/app/              Pages: optimizer, results, history, settings
│   ├── src/components/       Design-system components (cards, tabs, score chart, diff view…)
│   └── src/lib/              Typed API client (incl. SSE consumer), formatters, word-diff helper
├── dashboard/              # Streamlit dashboard — lightweight alternative front end
│   └── app.py
├── presets/
│   └── challenges.json       Five starter prompts: summarization, classification, Q&A, codegen, extraction
├── tests/                  # Offline pytest suite (fake Anthropic clients, no API key needed)
├── optimize.py             # CLI entry point
├── requirements.txt
├── .env.example
└── README.md
```

---

## Getting started

### Prerequisites

- **Python 3.11+** (developed and tested on 3.13.2)
- An [Anthropic API key](https://console.anthropic.com/)
- **Node.js 20.9+ and npm** — only required if you want to run the Next.js (PromptForge) frontend

### 1. Clone and set up the Python environment

```bash
git clone <this-repo-url>
cd Prompt_Optimizer

python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Add your API key

```bash
cp .env.example .env
```

Open `.env` and set:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else in `.env` already has sensible defaults — see [Configuration](#configuration)
if you want to tune models or loop sizes.

### 3. (Optional) Set up the Next.js frontend

Only needed for the PromptForge dashboard — skip this if you're sticking to the CLI, the API, or
the Streamlit dashboard, none of which need Node.js at all.

```bash
cd web
npm install
cd ..
```

You're ready — pick any of the three ways to run it below. ⬇️

---

## Usage

This project ships with **three interchangeable front ends** over one shared engine and one
shared SQLite database — start a session in any of them and it shows up in all the others.

| Front end | Run with | Best for |
|---|---|---|
| 🎨 **PromptForge** (`server/` + `web/`) | two processes (FastAPI + Next.js) | The full, polished dashboard experience — live streaming, charts, diffs, history. **Recommended.** |
| 📊 **Streamlit dashboard** (`dashboard/`) | one process, no Node.js | A lighter alternative with the same core views and zero frontend build step |
| ⌨️ **CLI** (`optimize.py`) | one command | Scripting, automation, CI pipelines, or just watching the loop run in a terminal |

### 🎨 PromptForge dashboard (recommended)

A two-process app: FastAPI exposes the engine as REST + a live SSE stream, and Next.js renders it
as a custom-built dashboard.

```bash
# Terminal 1 — API on :8000
.venv/bin/uvicorn server.main:app --reload --port 8000

# Terminal 2 — frontend on :3000
cd web && npm run dev
```

Open **http://localhost:3000**. You'll find four views:

- **Prompt Optimizer** (`/`) — write or paste a prompt, tune iterations & samples (with live
  cost/time estimates), and hit *Run Optimization* to watch progress stream in live over SSE —
  sampling, judging, and rewriting, step by step — before landing on that run's results.
- **Results & Analysis** (`/results`) — a custom-built SVG score-improvement curve, a clickable
  iteration log, and a tabbed detail panel: a **word-level prompt diff** (original vs. any
  iteration), **per-dimension eval scores** with the optimizer's critique, and every **sample
  output** with its individual judge score and critique.
- **Session History** (`/history`) — a searchable table of every run with start/final scores,
  deltas, status, and per-row View / Export / Rename / Delete actions.
- **Settings** (`/settings`) — a live, read-only view of the server's model and storage
  configuration, so you always know exactly what's running and where to change it.

### 📊 Streamlit dashboard (lightweight alternative)

A single-process app with the same core views and no frontend build step:

```bash
streamlit run dashboard/app.py
```

Open **http://localhost:8501**.

- **Home** — a quick explainer of how the loop works, with shortcuts into a new run or your history
- **New Run** — pick one of five preset challenges (or write your own prompt), set
  iterations/samples, and watch a live iteration log, per-dimension score metrics, and an
  updating score curve as it runs — then see the original-vs-optimized diff
- **History** — browse past sessions, chart their score curves (total + each rubric dimension),
  diff prompts, drill into per-iteration critiques and sample outputs, rename/delete sessions,
  export to CSV, and overlay multiple runs to compare them

### ⌨️ CLI

The fastest way to run a one-off optimization from a terminal — no servers, no UI:

```bash
python optimize.py --prompt "Summarize this article in 3 bullets" --iters 5
```

```
Useful flags:
  --samples N             samples averaged per iteration (default: 3)
  --name "my-session"     label the run in the history store
  --export scores.csv     write the per-iteration score table to CSV
  --db PATH               override the SQLite history file path
  --runner-model / --optimizer-model / --evaluator-model   override model IDs
```

Each iteration prints its score and delta from the previous round, and is saved to the SQLite
history file as it completes — instantly visible from either dashboard.

---

## Configuration

All knobs live in `.env` (copy `.env.example` to start) and can be overridden per-run via CLI
flags or the dashboards' controls:

| Setting | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Your Anthropic API key — every front end disables itself until this is set |
| `OPTIMIZER_RUNNER_MODEL` | `claude-sonnet-4-6` | Executes the candidate prompt to produce sample outputs |
| `OPTIMIZER_OPTIMIZER_MODEL` | `claude-sonnet-4-6` | Rewrites the prompt via the meta-prompt each iteration |
| `OPTIMIZER_EVALUATOR_MODEL` | `claude-haiku-4-5-20251001` | Judges every output (highest call volume — a cheaper/faster model by design) |
| `OPTIMIZER_N_SAMPLES` | `3` | Independent outputs sampled (and judged) per iteration |
| `OPTIMIZER_N_ITERATIONS` | `5` | Optimization rounds per run |
| `OPTIMIZER_DB_PATH` | `optimizer_history.db` | SQLite history file location |

> All three front ends — CLI, FastAPI/Next.js, and Streamlit — load this *exact same* config via
> `OptimizerConfig.from_env()`, so they can never drift out of sync. Changing a model means
> editing `.env` and restarting the relevant process; it's intentionally never a per-UI toggle.

---

## Testing

```bash
pytest
```

The full suite runs **completely offline** — every module (`evaluator`, `pipeline`, `storage`) is
exercised against fake/scripted Anthropic clients, so no API key or network access is required to
verify correctness. Coverage includes:

- JSON-parsing edge cases in the evaluator (clean JSON, markdown-fenced JSON, malformed → safe fallback)
- The optimization loop's event sequencing and history shape across multiple iterations
- SQLite session/iteration CRUD, renaming, deletion (with cascade), summary stats, and CSV export

---

## Deployment

### PromptForge (FastAPI + Next.js)

Two stateless processes sharing one SQLite file:

1. **API** — run `uvicorn server.main:app --host 0.0.0.0 --port 8000` anywhere that can persist
   `ANTHROPIC_API_KEY` and the SQLite file (a VM, Render, Fly.io, etc.)
2. **Frontend** — `cd web && npm run build && npm start`, or deploy to **Vercel**. Point
   `NEXT_PUBLIC_API_BASE` (see `web/src/lib/api.ts`) at your API's public URL, and make sure the
   API's CORS `allow_origins` (in `server/main.py`) includes your frontend's deployed origin.

### Streamlit dashboard

A stateless Streamlit app over the same SQLite file — deploys cleanly to **Streamlit Community Cloud**:

1. Push this repo to GitHub
2. On [share.streamlit.io](https://share.streamlit.io), create a new app pointing at `dashboard/app.py`
3. In the app's **Secrets**, add `ANTHROPIC_API_KEY = "sk-ant-..."` (and any model overrides from
   the table above)

Locally or on any other host, `streamlit run dashboard/app.py` with `.env` populated is enough —
no database server or extra infrastructure required.

---

## Design notes / FAQ

**Why judge with a separate model instead of letting the runner grade itself?**
Self-evaluation is biased — a model tends to rate its own output favorably. Using a distinct
"evaluator" model mirrors real eval practice, and here it's also a cheaper, faster model, since
judging is the highest-call-volume role (it runs once per sample, every single iteration).

**Why average multiple samples instead of judging a single output?**
A single generation is noisy — the same prompt can produce a great answer once and a mediocre one
the next time. Averaging several samples gives the optimizer a stable signal before it commits to
rewriting anything.

**Why four separate scoring dimensions instead of one overall number?**
So each can be tracked and charted independently, and so the optimizer gets specific, actionable
feedback — *"clarity is lagging"* is far more useful to act on than *"7.2/10 overall"*.

**Why is the pipeline a generator?**
`optimize_prompt()` *yields* progress events (`iteration_start`, `outputs`, `scores`,
`rewritten`, `iteration_complete`, `done`) as it runs, instead of just returning a final result.
That single design choice is what lets the CLI print live progress, the Streamlit dashboard
update its log and chart incrementally, and the FastAPI backend stream everything to the browser
over SSE — all from the *exact same loop*, with zero duplicated orchestration logic.

**Why SQLite instead of a "real" database?**
The whole app is single-user and local-first by default — a file-based database means zero setup,
trivially easy backups (it's just a file), and the same store works identically whether it's
opened from a terminal script, a Streamlit process, or a FastAPI server.

---

## License

This project does not yet include a license file. If you plan to publish or share it, consider
adding one — [MIT](https://choosealicense.com/licenses/mit/) is a common, permissive choice — to
make the terms of use explicit for anyone who finds it on GitHub.

---

<sub>Built on <a href="https://www.anthropic.com/">Anthropic Claude</a> — running & optimizing on
Sonnet, evaluation on Haiku by default, every model fully swappable via <code>.env</code>.</sub>
