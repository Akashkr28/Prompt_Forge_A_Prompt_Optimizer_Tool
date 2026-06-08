"""LLM-as-judge: scores runner outputs across four dimensions as structured JSON.

Judge models occasionally wrap JSON in prose or markdown fences despite being
told not to. ``_parse_eval_json`` extracts and validates the score object
defensively, retries once with a stricter follow-up on failure, and finally
falls back to a neutral score so a single malformed judgement can't take down
an entire optimization run.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor

DIMENSIONS = ("accuracy", "clarity", "completeness", "conciseness")

EVAL_PROMPT = """\
You are a strict output evaluator. Score the following LLM output
on a scale of 0-10 across these dimensions:
- Accuracy (0-10): Does it answer the question correctly?
- Clarity (0-10): Is the output easy to understand?
- Completeness (0-10): Does it cover all required aspects?
- Conciseness (0-10): Is it appropriately brief?

Output ONLY valid JSON, with no markdown fences and no extra text, like:
{{
  "accuracy": 8,
  "clarity": 7,
  "completeness": 9,
  "conciseness": 6,
  "total": 7.5,
  "critique": "Missing examples, slightly verbose in section 2"
}}

## Prompt Used
{prompt}

## Output to Evaluate
{output}
"""

_RETRY_SUFFIX = (
    "\n\nYour previous response could not be parsed as JSON. Respond again with "
    "ONLY the JSON object — no markdown fences, no commentary, nothing before or "
    "after the braces."
)

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)

_FALLBACK_SCORE = {
    "accuracy": 5,
    "clarity": 5,
    "completeness": 5,
    "conciseness": 5,
    "total": 5.0,
    "critique": "Evaluator response could not be parsed as valid JSON; using a neutral fallback score.",
}


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text.strip()).strip()


def _coerce_score(value) -> float:
    score = float(value)
    return max(0.0, min(10.0, score))


def _parse_eval_json(raw_text: str) -> dict | None:
    """Best-effort extraction + validation of the evaluator's JSON payload.

    Returns a normalized dict with all required keys, or ``None`` if the text
    cannot be coerced into a valid score object.
    """
    candidate = _strip_fences(raw_text)
    match = _JSON_OBJECT_RE.search(candidate)
    if match:
        candidate = match.group(0)

    try:
        data = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    try:
        normalized = {dim: _coerce_score(data[dim]) for dim in DIMENSIONS}
    except (KeyError, TypeError, ValueError):
        return None

    if "total" in data:
        try:
            normalized["total"] = _coerce_score(data["total"])
        except (TypeError, ValueError):
            normalized["total"] = round(sum(normalized.values()) / len(DIMENSIONS), 2)
    else:
        normalized["total"] = round(sum(normalized.values()) / len(DIMENSIONS), 2)

    critique = data.get("critique", "")
    normalized["critique"] = str(critique) if critique is not None else ""
    return normalized


def evaluate_output(client, model: str, prompt: str, output: str, max_tokens: int = 512) -> dict:
    """Score a single runner output, retrying once on a malformed JSON response."""
    eval_input = EVAL_PROMPT.format(prompt=prompt, output=output)

    for attempt in range(2):
        message_input = eval_input if attempt == 0 else eval_input + _RETRY_SUFFIX
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": message_input}],
        )
        raw_text = response.content[0].text
        parsed = _parse_eval_json(raw_text)
        if parsed is not None:
            return parsed

    fallback = dict(_FALLBACK_SCORE)
    fallback["critique"] = (
        f"{_FALLBACK_SCORE['critique']} Raw response: {raw_text[:200]!r}"
    )
    return fallback


def evaluate_outputs(client, model: str, prompt: str, outputs: list[str], max_tokens: int = 512) -> dict:
    """Score every output (concurrently) and average each dimension + total.

    Returns ``{"scores": [...], "avg_total": float, "avg_dimensions": {...}}``
    so the caller (and the dashboard) can chart each rubric dimension on its
    own, not just the headline total.
    """
    with ThreadPoolExecutor(max_workers=max(1, len(outputs))) as pool:
        scores = list(
            pool.map(lambda o: evaluate_output(client, model, prompt, o, max_tokens), outputs)
        )

    avg_dimensions = {
        dim: round(sum(s[dim] for s in scores) / len(scores), 2) for dim in DIMENSIONS
    }
    avg_total = round(sum(s["total"] for s in scores) / len(scores), 2)

    return {
        "scores": scores,
        "avg_total": avg_total,
        "avg_dimensions": avg_dimensions,
    }
