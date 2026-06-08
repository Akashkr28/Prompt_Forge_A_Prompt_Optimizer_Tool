"""Tests for the LLM-as-judge scoring logic, run entirely offline against a
fake Anthropic client — no network access or API key required."""

import threading

from optimizer.evaluator import DIMENSIONS, _parse_eval_json, evaluate_output, evaluate_outputs

VALID_JSON = (
    '{"accuracy": 8, "clarity": 7, "completeness": 9, "conciseness": 6, '
    '"total": 7.5, "critique": "Missing examples"}'
)
FENCED_JSON = "Here is my evaluation:\n```json\n" + VALID_JSON + "\n```"
MALFORMED = "Sure! My assessment is that this output is pretty good overall."


class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeResponse:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


class _QueueClient:
    """Returns canned response texts in order; thread-safe for concurrent judging."""

    def __init__(self, texts):
        self._texts = list(texts)
        self._lock = threading.Lock()
        self.calls = []
        self.messages = self

    def create(self, model, max_tokens, messages):
        with self._lock:
            self.calls.append(model)
            text = self._texts.pop(0) if len(self._texts) > 1 else self._texts[0]
        return _FakeResponse(text)


# -- _parse_eval_json ---------------------------------------------------------

def test_parse_eval_json_handles_clean_json():
    parsed = _parse_eval_json(VALID_JSON)
    assert parsed is not None
    assert parsed["accuracy"] == 8.0
    assert parsed["total"] == 7.5
    assert parsed["critique"] == "Missing examples"
    assert set(DIMENSIONS).issubset(parsed)


def test_parse_eval_json_strips_markdown_fences():
    parsed = _parse_eval_json(FENCED_JSON)
    assert parsed is not None
    assert parsed["clarity"] == 7.0


def test_parse_eval_json_returns_none_for_prose():
    assert _parse_eval_json(MALFORMED) is None


def test_parse_eval_json_clamps_out_of_range_scores():
    raw = '{"accuracy": 15, "clarity": -3, "completeness": 5, "conciseness": 5, "critique": ""}'
    parsed = _parse_eval_json(raw)
    assert parsed["accuracy"] == 10.0
    assert parsed["clarity"] == 0.0
    # total was absent, so it's derived as the mean of the four dimensions
    assert parsed["total"] == round((10.0 + 0.0 + 5.0 + 5.0) / 4, 2)


# -- evaluate_output -----------------------------------------------------------

def test_evaluate_output_retries_once_then_succeeds():
    client = _QueueClient([MALFORMED, VALID_JSON])
    result = evaluate_output(client, "fake-evaluator", "prompt", "output")
    assert result["total"] == 7.5
    assert len(client.calls) == 2


def test_evaluate_output_falls_back_to_neutral_score_after_two_failures():
    client = _QueueClient([MALFORMED, MALFORMED])
    result = evaluate_output(client, "fake-evaluator", "prompt", "output")
    assert result["total"] == 5.0
    assert all(result[dim] == 5 for dim in DIMENSIONS)
    assert "could not be parsed" in result["critique"]
    assert len(client.calls) == 2


# -- evaluate_outputs -----------------------------------------------------------

def test_evaluate_outputs_averages_each_dimension_independently():
    client = _QueueClient([VALID_JSON, VALID_JSON, VALID_JSON])
    result = evaluate_outputs(client, "fake-evaluator", "prompt", ["a", "b", "c"])

    assert result["avg_total"] == 7.5
    assert result["avg_dimensions"] == {
        "accuracy": 8.0,
        "clarity": 7.0,
        "completeness": 9.0,
        "conciseness": 6.0,
    }
    assert len(result["scores"]) == 3
