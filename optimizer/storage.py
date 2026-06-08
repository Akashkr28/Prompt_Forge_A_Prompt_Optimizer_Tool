"""SQLite-backed history of optimization sessions and their iterations.

Plain stdlib ``sqlite3`` — an ORM would be overkill for two tables and a
handful of queries, and SQLite gives us a single-file, zero-setup store that
both the CLI and the dashboard can open directly. This is what makes the score
curve a portfolio artifact: without persisted history, every run is just a
transient chat exchange.
"""

from __future__ import annotations

import csv
import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    original_prompt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    runner_model TEXT NOT NULL,
    optimizer_model TEXT NOT NULL,
    evaluator_model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS iterations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    iteration INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    avg_total REAL NOT NULL,
    avg_accuracy REAL NOT NULL,
    avg_clarity REAL NOT NULL,
    avg_completeness REAL NOT NULL,
    avg_conciseness REAL NOT NULL,
    critique TEXT,
    raw_scores TEXT NOT NULL,
    outputs TEXT NOT NULL,
    UNIQUE(session_id, iteration)
);
"""


@dataclass(frozen=True)
class Session:
    id: int
    name: str | None
    original_prompt: str
    created_at: str
    runner_model: str
    optimizer_model: str
    evaluator_model: str


@dataclass(frozen=True)
class Iteration:
    id: int
    session_id: int
    iteration: int
    prompt: str
    avg_total: float
    avg_dimensions: dict
    critique: str
    raw_scores: list
    outputs: list


class Storage:
    """Thin wrapper around a SQLite file holding optimization run history."""

    def __init__(self, db_path: str = "optimizer_history.db"):
        self.db_path = db_path
        with closing(self._connect()) as conn:
            conn.executescript(_SCHEMA)
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.row_factory = sqlite3.Row
        return conn

    # -- sessions ---------------------------------------------------------

    def create_session(
        self,
        original_prompt: str,
        runner_model: str,
        optimizer_model: str,
        evaluator_model: str,
        name: str | None = None,
    ) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                """
                INSERT INTO sessions
                    (name, original_prompt, created_at, runner_model, optimizer_model, evaluator_model)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, original_prompt, created_at, runner_model, optimizer_model, evaluator_model),
            )
            conn.commit()
            return cursor.lastrowid

    def get_session(self, session_id: int) -> Session | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return _row_to_session(row) if row else None

    def list_sessions(self) -> list[Session]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM sessions ORDER BY created_at DESC").fetchall()
        return [_row_to_session(row) for row in rows]

    # -- iterations -------------------------------------------------------

    def save_iteration(self, session_id: int, record: dict) -> int:
        """Persist one history record produced by ``optimizer.pipeline.optimize_prompt``."""
        dims = record["avg_dimensions"]
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                """
                INSERT INTO iterations
                    (session_id, iteration, prompt, avg_total,
                     avg_accuracy, avg_clarity, avg_completeness, avg_conciseness,
                     critique, raw_scores, outputs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    record["iteration"],
                    record["prompt"],
                    record["avg_total"],
                    dims["accuracy"],
                    dims["clarity"],
                    dims["completeness"],
                    dims["conciseness"],
                    record.get("critique", ""),
                    json.dumps(record["raw_scores"]),
                    json.dumps(record["outputs"]),
                ),
            )
            conn.commit()
            return cursor.lastrowid

    def get_iterations(self, session_id: int) -> list[Iteration]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM iterations WHERE session_id = ? ORDER BY iteration ASC",
                (session_id,),
            ).fetchall()
        return [_row_to_iteration(row) for row in rows]

    # -- export ------------------------------------------------------------

    def export_csv(self, session_id: int, path: str) -> None:
        """Write one row per iteration (score columns only) for the given session."""
        iterations = self.get_iterations(session_id)
        fieldnames = [
            "iteration",
            "avg_total",
            "avg_accuracy",
            "avg_clarity",
            "avg_completeness",
            "avg_conciseness",
            "critique",
            "prompt",
        ]
        with open(path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for it in iterations:
                writer.writerow(
                    {
                        "iteration": it.iteration,
                        "avg_total": it.avg_total,
                        "avg_accuracy": it.avg_dimensions["accuracy"],
                        "avg_clarity": it.avg_dimensions["clarity"],
                        "avg_completeness": it.avg_dimensions["completeness"],
                        "avg_conciseness": it.avg_dimensions["conciseness"],
                        "critique": it.critique,
                        "prompt": it.prompt,
                    }
                )


def _row_to_session(row: sqlite3.Row) -> Session:
    return Session(
        id=row["id"],
        name=row["name"],
        original_prompt=row["original_prompt"],
        created_at=row["created_at"],
        runner_model=row["runner_model"],
        optimizer_model=row["optimizer_model"],
        evaluator_model=row["evaluator_model"],
    )


def _row_to_iteration(row: sqlite3.Row) -> Iteration:
    return Iteration(
        id=row["id"],
        session_id=row["session_id"],
        iteration=row["iteration"],
        prompt=row["prompt"],
        avg_total=row["avg_total"],
        avg_dimensions={
            "accuracy": row["avg_accuracy"],
            "clarity": row["avg_clarity"],
            "completeness": row["avg_completeness"],
            "conciseness": row["avg_conciseness"],
        },
        critique=row["critique"] or "",
        raw_scores=json.loads(row["raw_scores"]),
        outputs=json.loads(row["outputs"]),
    )
