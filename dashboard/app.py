"""Streamlit dashboard for the meta-prompting prompt optimizer.

Two views:
  - New Run:  kick off an optimization, watch a live iteration log and a
              score curve grow in real time (consumes the same generator the
              CLI uses, so behavior never drifts between the two front ends).
  - History:  browse past sessions, inspect the score curve, diff the
              original prompt against the optimized one, drill into each
              iteration's judge critiques/outputs, overlay multiple sessions,
              and export the score table to CSV.
"""

from __future__ import annotations

import difflib
import json
import os
import sys
import tempfile
from pathlib import Path

# `streamlit run dashboard/app.py` only puts this file's directory on sys.path,
# not the project root — add it so `optimizer` is importable regardless of how
# (or from where) the app is launched, including on Streamlit Community Cloud.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic
import plotly.graph_objects as go
import streamlit as st

from optimizer.config import OptimizerConfig
from optimizer.pipeline import optimize_prompt
from optimizer.storage import Iteration, Session, Storage

DIMENSIONS = ("accuracy", "clarity", "completeness", "conciseness")
PRESETS_PATH = os.path.join(os.path.dirname(__file__), "..", "presets", "challenges.json")

st.set_page_config(page_title="Prompt Optimizer", page_icon="🔁", layout="wide")


# ---------------------------------------------------------------------------
# Cached resources / data loaders
# ---------------------------------------------------------------------------

@st.cache_resource
def get_storage(db_path: str) -> Storage:
    return Storage(db_path)


@st.cache_resource
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


@st.cache_data
def load_presets() -> list[dict]:
    try:
        with open(PRESETS_PATH, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Shared chart / formatting helpers
# ---------------------------------------------------------------------------

def score_curve_figure(curves: dict[str, list[tuple[int, float]]], title: str) -> go.Figure:
    """Build a line chart from ``{series_name: [(iteration, score), ...]}``."""
    fig = go.Figure()
    for name, points in curves.items():
        if not points:
            continue
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        fig.add_trace(go.Scatter(x=xs, y=ys, mode="lines+markers", name=name))
    fig.update_layout(
        title=title,
        xaxis_title="Iteration",
        yaxis_title="Score (0-10)",
        yaxis_range=[0, 10],
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=60, b=40),
    )
    return fig


def navigate_to(view_label: str) -> None:
    """Switch the sidebar view from inside a button handler.

    Streamlit forbids writing to ``st.session_state["view"]`` once the radio
    widget bound to that key has rendered this run, so we stash the target in
    a plain (non-widget) key and let ``main`` apply it on the next run, before
    the radio is instantiated.
    """
    st.session_state["pending_view"] = view_label
    st.rerun()


def session_label(session: Session) -> str:
    name = session.name or f"Session #{session.id}"
    prompt_preview = session.original_prompt.strip().replace("\n", " ")
    if len(prompt_preview) > 60:
        prompt_preview = prompt_preview[:57] + "..."
    return f"#{session.id} · {name} — “{prompt_preview}” ({session.created_at[:19]})"


def render_diff(original: str, final: str) -> None:
    diff_lines = list(
        difflib.unified_diff(
            original.splitlines(),
            final.splitlines(),
            fromfile="original prompt",
            tofile="optimized prompt",
            lineterm="",
        )
    )
    if not diff_lines:
        st.info("The optimized prompt is identical to the original.")
        return

    # st.code's "diff" language gives us +/- syntax highlighting for free —
    # far more robust than hand-rolling colored spans (which fight Streamlit's
    # own `:color[...]` markdown directives once wrapped in raw HTML).
    st.code("\n".join(diff_lines), language="diff")


def iterations_csv_bytes(storage: Storage, session_id: int) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        storage.export_csv(session_id, tmp_path)
        with open(tmp_path, "rb") as handle:
            return handle.read()
    finally:
        os.unlink(tmp_path)


def render_session_controls(storage: Storage, session: Session, iteration_count: int) -> None:
    """Rename / delete controls for the selected session (delete behind a confirm step,
    since it permanently removes the session and — via ``ON DELETE CASCADE`` — its iterations)."""
    with st.expander("✏️ Rename or delete this session"):
        new_name = st.text_input("Session name", value=session.name or "", key=f"rename-input-{session.id}")
        if st.button("Save name", key=f"rename-save-{session.id}"):
            storage.rename_session(session.id, new_name.strip() or None)
            st.success("Session renamed.")
            st.rerun()

        st.divider()
        confirm_key = f"confirm-delete-{session.id}"
        if st.session_state.get(confirm_key):
            st.warning(
                f"Delete session #{session.id} and its {iteration_count} iteration(s)? "
                "This cannot be undone."
            )
            yes_col, no_col = st.columns(2)
            if yes_col.button("Yes, delete it", type="primary", key=f"delete-yes-{session.id}"):
                storage.delete_session(session.id)
                st.session_state.pop(confirm_key, None)
                st.success(f"Session #{session.id} deleted.")
                st.rerun()
            if no_col.button("Cancel", key=f"delete-cancel-{session.id}"):
                st.session_state.pop(confirm_key, None)
                st.rerun()
        else:
            if st.button("🗑️ Delete session", key=f"delete-start-{session.id}"):
                st.session_state[confirm_key] = True
                st.rerun()


def curves_from_iterations(iterations: list[Iteration]) -> dict[str, list[tuple[int, float]]]:
    curves: dict[str, list[tuple[int, float]]] = {"total": []}
    for dim in DIMENSIONS:
        curves[dim] = []
    for it in iterations:
        curves["total"].append((it.iteration, it.avg_total))
        for dim in DIMENSIONS:
            curves[dim].append((it.iteration, it.avg_dimensions[dim]))
    return curves


# ---------------------------------------------------------------------------
# View: Home (landing page)
# ---------------------------------------------------------------------------

def render_home(storage: Storage, base_config: OptimizerConfig) -> None:
    st.markdown(
        "#### Turn a rough prompt into a sharp one — automatically\n"
        "Give it a starting prompt and it loops: **run** it against a model, **judge** the "
        "outputs against a rubric, **rewrite** the prompt to fix what's weak, then repeat — "
        "charting the score climb the whole way."
    )

    cta_col1, cta_col2 = st.columns(2)
    with cta_col1:
        if st.button("🧪 Start a new optimization", type="primary", use_container_width=True):
            navigate_to("🧪 New Run")
    with cta_col2:
        if st.button("📜 Browse session history", use_container_width=True):
            navigate_to("📜 History")

    st.divider()
    st.subheader("How the loop works")

    steps = [
        (
            "🏃",
            "1. Run",
            f"`{base_config.runner_model}` executes the prompt {base_config.n_samples}x in "
            "parallel, sampling a representative spread of outputs.",
        ),
        (
            "⚖️",
            "2. Judge",
            f"`{base_config.evaluator_model}` scores every output against a rubric — accuracy, "
            "clarity, completeness, conciseness — and writes a critique.",
        ),
        (
            "🛠️",
            "3. Rewrite",
            f"`{base_config.optimizer_model}` reads the prompt, outputs, scores and critique, "
            "then rewrites the prompt to address the weak spots.",
        ),
    ]
    for col, (icon, title, body) in zip(st.columns(3), steps):
        with col.container(border=True):
            st.markdown(f"**{icon} {title}**")
            st.caption(body)
    st.caption(
        f"...and the loop repeats for {base_config.n_iterations} iterations by default "
        "(adjustable per run), with the score curve charted live as it climbs."
    )

    st.divider()
    stats = storage.get_summary_stats()
    if stats["session_count"]:
        st.subheader("📈 Your activity so far")
        s1, s2, s3, s4 = st.columns(4)
        s1.metric("Sessions run", stats["session_count"])
        s2.metric("Iterations completed", stats["iteration_count"])
        s3.metric("Best score reached", f"{stats['best_score']:.2f} / 10")
        s4.metric("Avg. final score", f"{stats['avg_final_score']:.2f} / 10")

        st.markdown("**Recent sessions**")
        for session in storage.list_sessions()[:3]:
            iterations = storage.get_iterations(session.id)
            latest = f"{iterations[-1].avg_total:.2f}" if iterations else "—"
            st.caption(f"• {session_label(session)} — latest score **{latest}**")
    else:
        st.info(
            "No sessions yet — click **Start a new optimization** above to run your first "
            "loop and start building a score-improvement history."
        )


# ---------------------------------------------------------------------------
# View: New Run
# ---------------------------------------------------------------------------

def render_new_run(storage: Storage, base_config: OptimizerConfig) -> None:
    st.header("🧪 Run a new optimization")

    with st.container(border=True):
        presets = load_presets()
        preset_labels = ["Custom prompt"] + [p["label"] for p in presets]
        choice = st.selectbox("Start from a preset challenge or write your own:", preset_labels)

        if choice == "Custom prompt":
            default_prompt = ""
        else:
            default_prompt = next(p["prompt"] for p in presets if p["label"] == choice)

        prompt = st.text_area("Original prompt", value=default_prompt, height=120)

        col1, col2, col3 = st.columns(3)
        with col1:
            n_iterations = st.slider("Iterations", min_value=1, max_value=10, value=base_config.n_iterations)
        with col2:
            n_samples = st.slider("Samples per iteration", min_value=1, max_value=5, value=base_config.n_samples)
        with col3:
            session_name = st.text_input("Session name (optional)", value="")

        run_clicked = st.button("Run optimization", type="primary", disabled=not prompt.strip())

    if not run_clicked:
        return

    if not os.environ.get("ANTHROPIC_API_KEY"):
        st.error("ANTHROPIC_API_KEY is not set. Add it to your environment or `.env` file and restart.")
        return

    config = base_config.with_overrides(n_iterations=n_iterations, n_samples=n_samples)
    client = get_client()

    session_id = storage.create_session(
        original_prompt=prompt,
        runner_model=config.runner_model,
        optimizer_model=config.optimizer_model,
        evaluator_model=config.evaluator_model,
        name=session_name or None,
    )
    st.caption(
        f"Session #{session_id} · runner={config.runner_model} · "
        f"optimizer={config.optimizer_model} · evaluator={config.evaluator_model}"
    )

    metrics_placeholder = st.empty()
    chart_placeholder = st.empty()
    log_container = st.status("Starting optimization...", expanded=True)

    curves: dict[str, list[tuple[int, float]]] = {"total": [], **{d: [] for d in DIMENSIONS}}
    history: list[dict] = []
    previous_score = None

    for event in optimize_prompt(client, config, prompt):
        etype = event["type"]

        if etype == "iteration_start":
            log_container.update(label=f"Iteration {event['iteration']}/{config.n_iterations}: running prompt...")
            log_container.write(f"**Iteration {event['iteration']}** — running prompt against {config.runner_model} x{config.n_samples}")

        elif etype == "scores":
            iteration = event["iteration"]
            eval_result = event["eval_result"]
            curves["total"].append((iteration, eval_result["avg_total"]))
            for dim in DIMENSIONS:
                curves[dim].append((iteration, eval_result["avg_dimensions"][dim]))
            chart_placeholder.plotly_chart(
                score_curve_figure(curves, "Score curve (live)"), use_container_width=True
            )
            total_delta = None if previous_score is None else eval_result["avg_total"] - previous_score
            with metrics_placeholder.container():
                cols = st.columns(5)
                cols[0].metric(
                    "Total",
                    f"{eval_result['avg_total']:.2f}",
                    delta=f"{total_delta:+.2f}" if total_delta is not None else None,
                )
                for col, dim in zip(cols[1:], DIMENSIONS):
                    col.metric(dim.capitalize(), f"{eval_result['avg_dimensions'][dim]:.2f}")
            log_container.write(f"Iteration {iteration} scored — total **{eval_result['avg_total']:.2f}**")
            previous_score = eval_result["avg_total"]

        elif etype == "rewritten":
            log_container.write(f"Iteration {event['iteration']}: prompt rewritten for the next round")

        elif etype == "iteration_complete":
            record = event["record"]
            history.append(record)
            storage.save_iteration(session_id, record)
            with log_container.expander(f"Iteration {record['iteration']} details", expanded=False):
                st.write(f"**Critique:** {record['critique'] or '_none_'}")
                st.write("**Sample outputs:**")
                for idx, output in enumerate(record["outputs"], start=1):
                    st.text_area(f"Sample {idx}", value=output, height=100, key=f"live-{session_id}-{record['iteration']}-{idx}")

        elif etype == "done":
            log_container.update(label="Optimization complete", state="complete", expanded=False)

    if history:
        first, last = history[0]["avg_total"], history[-1]["avg_total"]
        st.success(
            f"Done — score moved from {first:.2f} to {last:.2f} "
            f"(Δ {last - first:+.2f}) over {len(history)} iteration(s)."
        )
        st.subheader("📝 Original vs. optimized prompt")
        render_diff(prompt, history[-1]["prompt"])


# ---------------------------------------------------------------------------
# View: History & Compare
# ---------------------------------------------------------------------------

def render_history(storage: Storage) -> None:
    st.header("📜 Session history")

    sessions = storage.list_sessions()
    if not sessions:
        st.info("No sessions yet — run an optimization from the **New Run** view first.")
        return

    by_label = {session_label(s): s for s in sessions}
    selected_label = st.selectbox("Choose a session", list(by_label.keys()))
    session = by_label[selected_label]
    iterations = storage.get_iterations(session.id)

    st.markdown(f"**Original prompt:**\n\n> {session.original_prompt}")
    st.caption(
        f"runner={session.runner_model} · optimizer={session.optimizer_model} · "
        f"evaluator={session.evaluator_model} · created {session.created_at[:19]}"
    )
    render_session_controls(storage, session, len(iterations))

    if not iterations:
        st.info("This session has no recorded iterations yet.")
        return

    curves = curves_from_iterations(iterations)
    st.plotly_chart(score_curve_figure(curves, f"Score curve — {session_label(session)}"), use_container_width=True)

    st.subheader("📝 Original vs. final prompt")
    render_diff(session.original_prompt, iterations[-1].prompt)

    st.subheader("📋 Iteration log")
    for it in iterations:
        with st.expander(f"Iteration {it.iteration} — total {it.avg_total:.2f}"):
            st.write(
                f"accuracy={it.avg_dimensions['accuracy']:.2f} · "
                f"clarity={it.avg_dimensions['clarity']:.2f} · "
                f"completeness={it.avg_dimensions['completeness']:.2f} · "
                f"conciseness={it.avg_dimensions['conciseness']:.2f}"
            )
            st.write(f"**Critique:** {it.critique or '_none_'}")
            st.text_area("Prompt used this iteration", value=it.prompt, height=80, key=f"hist-prompt-{session.id}-{it.iteration}")
            for idx, output in enumerate(it.outputs, start=1):
                st.text_area(f"Sample {idx} output", value=output, height=100, key=f"hist-out-{session.id}-{it.iteration}-{idx}")

    st.download_button(
        "Export score table (CSV)",
        data=iterations_csv_bytes(storage, session.id),
        file_name=f"session_{session.id}_scores.csv",
        mime="text/csv",
    )

    st.divider()
    st.subheader("🆚 Compare sessions")
    compare_labels = st.multiselect(
        "Overlay score curves from multiple sessions",
        [label for label in by_label if by_label[label].id != session.id],
    )
    if compare_labels:
        overlay: dict[str, list[tuple[int, float]]] = {}
        for label in [selected_label] + compare_labels:
            sess = by_label[label]
            sess_iterations = storage.get_iterations(sess.id)
            overlay[f"#{sess.id} {sess.name or ''}".strip()] = [
                (it.iteration, it.avg_total) for it in sess_iterations
            ]
        st.plotly_chart(score_curve_figure(overlay, "Total score — session comparison"), use_container_width=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    st.title("🔁 Automated Prompt Optimizer")
    st.caption("Meta-prompting + LLM-as-judge: iteratively rewrite a prompt and watch its score climb.")

    base_config = OptimizerConfig.from_env()
    storage = get_storage(base_config.db_path)

    views = ["🏠 Home", "🧪 New Run", "📜 History"]
    pending_view = st.session_state.pop("pending_view", None)
    if pending_view is not None:
        st.session_state["view"] = pending_view
    st.session_state.setdefault("view", views[0])
    view = st.sidebar.radio("View", views, key="view")
    st.sidebar.divider()
    st.sidebar.caption(
        f"**Models**\n\n🏃 Runner: `{base_config.runner_model}`\n\n"
        f"🛠️ Optimizer: `{base_config.optimizer_model}`\n\n"
        f"⚖️ Evaluator: `{base_config.evaluator_model}`"
    )
    if not os.environ.get("ANTHROPIC_API_KEY"):
        st.sidebar.warning("ANTHROPIC_API_KEY not set — runs will fail until it's configured.")

    if view == "🏠 Home":
        render_home(storage, base_config)
    elif view == "🧪 New Run":
        render_new_run(storage, base_config)
    else:
        render_history(storage)


main()
