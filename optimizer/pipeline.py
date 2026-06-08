"""The optimization loop: run -> evaluate -> rewrite, repeated for N iterations.

``optimize_prompt`` is a generator rather than a function that returns a final
list. Both consumers — the CLI (prints a progress line per step) and the
Streamlit dashboard (renders a live iteration log and grows a chart as scores
land) — need to react to the loop *as it runs*, not just to its final result.
A generator lets both drive the exact same orchestration code instead of the
dashboard re-implementing the loop to get incremental updates.

Each yielded event is a dict with a ``"type"`` key:
  - ``iteration_start``   {iteration, prompt}
  - ``outputs``           {iteration, outputs}
  - ``scores``            {iteration, eval_result}   (avg_total, avg_dimensions, scores)
  - ``rewritten``         {iteration, new_prompt}
  - ``iteration_complete``{iteration, record}        (full history record for storage)
  - ``done``              {history}                  (final event; full run history)
"""

from __future__ import annotations

from optimizer.config import OptimizerConfig
from optimizer.evaluator import evaluate_outputs
from optimizer.meta_prompt import build_meta_prompt
from optimizer.runner import run_prompt

import json


def optimize_prompt(client, config: OptimizerConfig, original_prompt: str):
    """Yield progress events while iteratively improving ``original_prompt``.

    The final yielded event is ``{"type": "done", "history": [...]}`` where
    each history entry is a dict shaped for direct persistence via
    :mod:`optimizer.storage`.
    """
    history: list[dict] = []
    current_prompt = original_prompt

    for i in range(config.n_iterations):
        iteration = i + 1
        yield {"type": "iteration_start", "iteration": iteration, "prompt": current_prompt}

        outputs = run_prompt(
            client,
            config.runner_model,
            current_prompt,
            n=config.n_samples,
            max_tokens=config.runner_max_tokens,
        )
        yield {"type": "outputs", "iteration": iteration, "outputs": outputs}

        eval_result = evaluate_outputs(
            client,
            config.evaluator_model,
            current_prompt,
            outputs,
            max_tokens=config.evaluator_max_tokens,
        )
        yield {"type": "scores", "iteration": iteration, "eval_result": eval_result}

        critique = " | ".join(s["critique"] for s in eval_result["scores"] if s.get("critique"))

        is_last = iteration == config.n_iterations
        new_prompt = None
        if not is_last:
            meta_input = build_meta_prompt(
                original_prompt=current_prompt,
                sample_outputs=outputs,
                eval_scores=json.dumps(eval_result["scores"], indent=2),
                n_samples=config.n_samples,
            )
            response = client.messages.create(
                model=config.optimizer_model,
                max_tokens=config.optimizer_max_tokens,
                messages=[{"role": "user", "content": meta_input}],
            )
            new_prompt = response.content[0].text.strip()
            yield {"type": "rewritten", "iteration": iteration, "new_prompt": new_prompt}

        record = {
            "iteration": iteration,
            "prompt": current_prompt,
            "avg_total": eval_result["avg_total"],
            "avg_dimensions": eval_result["avg_dimensions"],
            "critique": critique,
            "raw_scores": eval_result["scores"],
            "outputs": outputs,
        }
        history.append(record)
        yield {"type": "iteration_complete", "iteration": iteration, "record": record}

        if new_prompt is not None:
            current_prompt = new_prompt

    yield {"type": "done", "history": history}
