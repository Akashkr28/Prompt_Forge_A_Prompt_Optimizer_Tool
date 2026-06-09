"""FastAPI app: REST + Server-Sent-Events endpoints over the optimizer engine.

This is a *thin* HTTP shell — every route delegates straight to the existing
``optimizer`` package (the same ``optimize_prompt`` generator and ``Storage``
class the CLI and Streamlit dashboard use), so behavior never drifts between
front ends; this is purely a different transport for the same engine.

Run with:  uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
import queue
import tempfile
import threading
from typing import Iterator

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from optimizer.config import OptimizerConfig
from optimizer.pipeline import optimize_prompt
from optimizer.storage import Session, Storage

DIMENSIONS = ("accuracy", "clarity", "completeness", "conciseness")
PRESETS_PATH = os.path.join(os.path.dirname(__file__), "..", "presets", "challenges.json")

app = FastAPI(title="Prompt Optimizer API")

# CORS origins are read from the ALLOWED_ORIGINS env var (comma-separated) so
# the deployed API on Render can accept requests from the Vercel frontend.
# Falls back to localhost dev origins when the var is not set.
_allowed_origins = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

_base_config = OptimizerConfig.from_env()
_storage = Storage(_base_config.db_path)


def _load_presets() -> list[dict]:
    try:
        with open(PRESETS_PATH, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Serialization — the storage layer hands back frozen dataclasses; the API
# speaks plain JSON-able dicts so the frontend never needs to know about them.
# ---------------------------------------------------------------------------

def _session_summary(session: Session, iterations: list) -> dict:
    first = iterations[0] if iterations else None
    latest = iterations[-1] if iterations else None
    return {
        "id": session.id,
        "name": session.name,
        "original_prompt": session.original_prompt,
        "created_at": session.created_at,
        "runner_model": session.runner_model,
        "optimizer_model": session.optimizer_model,
        "evaluator_model": session.evaluator_model,
        "iteration_count": len(iterations),
        "first_score": first.avg_total if first else None,
        "latest_score": latest.avg_total if latest else None,
        "delta": (latest.avg_total - first.avg_total) if (first and latest and first is not latest) else None,
    }


def _iteration_dict(it) -> dict:
    return {
        "id": it.id,
        "session_id": it.session_id,
        "iteration": it.iteration,
        "prompt": it.prompt,
        "avg_total": it.avg_total,
        "avg_dimensions": it.avg_dimensions,
        "critique": it.critique,
        "raw_scores": it.raw_scores,
        "outputs": it.outputs,
    }


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class OptimizeRequest(BaseModel):
    prompt: str
    n_iterations: int | None = None
    n_samples: int | None = None
    name: str | None = None


class RenameRequest(BaseModel):
    name: str | None = None


# ---------------------------------------------------------------------------
# Routes — meta / config
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def get_config():
    return {
        "runner_model": _base_config.runner_model,
        "optimizer_model": _base_config.optimizer_model,
        "evaluator_model": _base_config.evaluator_model,
        "n_iterations": _base_config.n_iterations,
        "n_samples": _base_config.n_samples,
        "dimensions": list(DIMENSIONS),
        "api_key_configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


@app.get("/api/presets")
def get_presets():
    return _load_presets()


@app.get("/api/stats")
def get_stats():
    return _storage.get_summary_stats()


# ---------------------------------------------------------------------------
# Routes — sessions (history, rename, delete, export)
# ---------------------------------------------------------------------------

@app.get("/api/sessions")
def list_sessions():
    sessions = _storage.list_sessions()
    return [_session_summary(s, _storage.get_iterations(s.id)) for s in sessions]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int):
    session = _storage.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    iterations = _storage.get_iterations(session_id)
    payload = _session_summary(session, iterations)
    payload["iterations"] = [_iteration_dict(it) for it in iterations]
    return payload


@app.patch("/api/sessions/{session_id}")
def rename_session(session_id: int, body: RenameRequest):
    if _storage.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    _storage.rename_session(session_id, (body.name or "").strip() or None)
    session = _storage.get_session(session_id)
    return _session_summary(session, _storage.get_iterations(session_id))


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int):
    if _storage.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    _storage.delete_session(session_id)
    return {"deleted": session_id}


@app.get("/api/sessions/{session_id}/export.csv")
def export_csv(session_id: int):
    session = _storage.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp_path = tmp.name
    _storage.export_csv(session_id, tmp_path)

    def stream_and_cleanup():
        try:
            with open(tmp_path, "rb") as handle:
                yield from handle
        finally:
            os.unlink(tmp_path)

    filename = f"session_{session_id}_scores.csv"
    return StreamingResponse(
        stream_and_cleanup(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Route — kick off an optimization and stream live progress as SSE
#
# Browsers' EventSource only supports GET, and a prompt is too large/unwieldy
# for a query string, so the frontend POSTs and reads the response body as a
# stream with `fetch` + a reader (a well-established SSE-over-POST pattern).
# ---------------------------------------------------------------------------

def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _run_and_stream(config: OptimizerConfig, prompt: str, session_id: int) -> Iterator[str]:
    """Bridge the synchronous, blocking ``optimize_prompt`` generator onto an
    SSE stream: drive it on a worker thread (so the event loop stays free),
    persist each completed iteration as it lands, and forward every progress
    event to the client in real time via a thread-safe queue."""
    events: "queue.Queue[dict | None]" = queue.Queue()

    def produce():
        try:
            client = anthropic.Anthropic()
            for event in optimize_prompt(client, config, prompt):
                if event["type"] == "iteration_complete":
                    _storage.save_iteration(session_id, event["record"])
                events.put(event)
        except Exception as exc:  # surface failures to the client rather than hanging it
            events.put({"type": "error", "message": str(exc)})
        finally:
            events.put(None)  # sentinel: stream complete

    threading.Thread(target=produce, daemon=True).start()

    yield _sse({"type": "session_created", "session_id": session_id})
    while True:
        event = events.get()
        if event is None:
            break
        yield _sse(event)
    yield "event: end\ndata: {}\n\n"


@app.post("/api/optimize")
def start_optimization(body: OptimizeRequest):
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=412,
            detail="ANTHROPIC_API_KEY is not set. Add it to your environment or .env file and restart the API server.",
        )

    config = _base_config.with_overrides(n_iterations=body.n_iterations, n_samples=body.n_samples)
    session_id = _storage.create_session(
        original_prompt=body.prompt,
        runner_model=config.runner_model,
        optimizer_model=config.optimizer_model,
        evaluator_model=config.evaluator_model,
        name=(body.name or "").strip() or None,
    )
    return StreamingResponse(
        _run_and_stream(config, body.prompt, session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
