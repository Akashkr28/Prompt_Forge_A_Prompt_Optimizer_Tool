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
dashboard/
  app.py          Streamlit UI: live runs + history/compare
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

### Dashboard

```bash
streamlit run dashboard/app.py
```

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

## Deploying the dashboard

The dashboard is a stateless Streamlit app over a single SQLite file, so it deploys cleanly to
**Streamlit Community Cloud**:

1. Push this repo to GitHub.
2. On [share.streamlit.io](https://share.streamlit.io), create a new app pointing at
   `dashboard/app.py`.
3. In the app's **Secrets**, add `ANTHROPIC_API_KEY = "sk-ant-..."` (and any model overrides you
   want from the table above).

Locally or on any other host, `streamlit run dashboard/app.py` with `.env` populated is enough —
no database server or extra infrastructure required.
