"""Tests for the SQLite session/iteration store and CSV export, against a
temporary on-disk database (pytest's tmp_path) — no shared state between tests."""

import pytest

from optimizer.storage import Storage


@pytest.fixture
def storage(tmp_path):
    return Storage(str(tmp_path / "history.db"))


def _record(iteration, avg_total):
    return {
        "iteration": iteration,
        "prompt": f"prompt v{iteration}",
        "avg_total": avg_total,
        "avg_dimensions": {"accuracy": 8.0, "clarity": 7.0, "completeness": 9.0, "conciseness": 6.0},
        "critique": "needs more examples",
        "raw_scores": [{"accuracy": 8, "total": avg_total, "critique": "needs more examples"}],
        "outputs": ["sample output text"],
    }


def test_create_and_get_session_roundtrip(storage):
    session_id = storage.create_session(
        original_prompt="Summarize this article",
        runner_model="runner-model",
        optimizer_model="optimizer-model",
        evaluator_model="evaluator-model",
        name="my session",
    )

    session = storage.get_session(session_id)
    assert session.id == session_id
    assert session.name == "my session"
    assert session.original_prompt == "Summarize this article"
    assert session.runner_model == "runner-model"


def test_list_sessions_orders_most_recent_first(storage):
    first_id = storage.create_session("p1", "r", "o", "e")
    second_id = storage.create_session("p2", "r", "o", "e")

    ids_in_order = [s.id for s in storage.list_sessions()]
    assert ids_in_order[:2] == [second_id, first_id]


def test_save_and_get_iterations_roundtrip(storage):
    session_id = storage.create_session("p", "r", "o", "e")
    storage.save_iteration(session_id, _record(1, avg_total=6.0))
    storage.save_iteration(session_id, _record(2, avg_total=8.0))

    iterations = storage.get_iterations(session_id)
    assert [it.iteration for it in iterations] == [1, 2]
    assert iterations[0].avg_total == 6.0
    assert iterations[1].avg_dimensions == {
        "accuracy": 8.0,
        "clarity": 7.0,
        "completeness": 9.0,
        "conciseness": 6.0,
    }
    assert iterations[0].outputs == ["sample output text"]
    assert iterations[0].raw_scores[0]["critique"] == "needs more examples"


def test_export_csv_writes_one_row_per_iteration(storage, tmp_path):
    session_id = storage.create_session("p", "r", "o", "e")
    storage.save_iteration(session_id, _record(1, avg_total=6.0))
    storage.save_iteration(session_id, _record(2, avg_total=8.0))

    csv_path = tmp_path / "scores.csv"
    storage.export_csv(session_id, str(csv_path))

    rows = csv_path.read_text(encoding="utf-8").strip().splitlines()
    assert rows[0].split(",")[:2] == ["iteration", "avg_total"]
    assert len(rows) == 3  # header + 2 iterations
    assert rows[1].startswith("1,6.0")
    assert rows[2].startswith("2,8.0")
