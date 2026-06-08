"""Tests for the optimization loop's event sequencing and history shape,
run against a fake client that routes responses by model id — no network."""

import threading

from optimizer.config import OptimizerConfig
from optimizer.pipeline import optimize_prompt

RUNNER_MODEL = "fake-runner"
EVALUATOR_MODEL = "fake-evaluator"
OPTIMIZER_MODEL = "fake-optimizer"

VALID_JSON = (
    '{"accuracy": 8, "clarity": 7, "completeness": 9, "conciseness": 6, '
    '"total": 7.5, "critique": "looks fine"}'
)


class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeResponse:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


class _RoleRoutedClient:
    """Routes messages.create to a canned response based on which role's model is used."""

    def __init__(self):
        self._lock = threading.Lock()
        self.calls: list[str] = []
        self.messages = self

    def create(self, model, max_tokens, messages):
        with self._lock:
            self.calls.append(model)
        if model == RUNNER_MODEL:
            return _FakeResponse("sample output")
        if model == EVALUATOR_MODEL:
            return _FakeResponse(VALID_JSON)
        if model == OPTIMIZER_MODEL:
            return _FakeResponse("rewritten prompt")
        raise AssertionError(f"unexpected model id: {model!r}")


def _make_config() -> OptimizerConfig:
    return OptimizerConfig(
        runner_model=RUNNER_MODEL,
        optimizer_model=OPTIMIZER_MODEL,
        evaluator_model=EVALUATOR_MODEL,
        n_samples=2,
        n_iterations=2,
    )


def test_event_sequence_skips_rewrite_on_final_iteration():
    client = _RoleRoutedClient()
    events = list(optimize_prompt(client, _make_config(), "Original prompt"))

    by_iteration: dict[int, list[str]] = {1: [], 2: []}
    for event in events:
        if "iteration" in event:
            by_iteration[event["iteration"]].append(event["type"])

    assert by_iteration[1] == ["iteration_start", "outputs", "scores", "rewritten", "iteration_complete"]
    assert by_iteration[2] == ["iteration_start", "outputs", "scores", "iteration_complete"]
    assert events[-1]["type"] == "done"


def test_history_chains_rewritten_prompt_into_next_iteration():
    client = _RoleRoutedClient()
    events = list(optimize_prompt(client, _make_config(), "Original prompt"))
    history = events[-1]["history"]

    assert len(history) == 2
    assert history[0]["prompt"] == "Original prompt"
    assert history[1]["prompt"] == "rewritten prompt"
    for record in history:
        assert record["avg_total"] == 7.5
        assert record["avg_dimensions"]["accuracy"] == 8.0
        assert len(record["outputs"]) == 2
        assert len(record["raw_scores"]) == 2
        assert record["critique"] == "looks fine | looks fine"


def test_each_role_is_called_the_expected_number_of_times():
    client = _RoleRoutedClient()
    list(optimize_prompt(client, _make_config(), "Original prompt"))

    # 2 iterations x 2 samples => 4 runner calls, 4 evaluator calls;
    # the optimizer only fires on non-final iterations => 1 call.
    assert client.calls.count(RUNNER_MODEL) == 4
    assert client.calls.count(EVALUATOR_MODEL) == 4
    assert client.calls.count(OPTIMIZER_MODEL) == 1
