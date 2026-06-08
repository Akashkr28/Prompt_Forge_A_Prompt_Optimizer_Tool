#!/usr/bin/env python3
"""CLI for the meta-prompting optimizer.

    python optimize.py --prompt "Summarize this article in 3 bullets" --iters 5
"""

from __future__ import annotations

import argparse
import os
import sys

import anthropic

from optimizer.config import OptimizerConfig
from optimizer.pipeline import optimize_prompt
from optimizer.storage import Storage


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Iteratively optimize a prompt via meta-prompting + LLM-as-judge.")
    parser.add_argument("--prompt", required=True, help="The original prompt to optimize.")
    parser.add_argument("--iters", type=int, default=None, help="Number of optimization iterations (default: 5).")
    parser.add_argument("--samples", type=int, default=None, help="Samples per iteration to average over (default: 3).")
    parser.add_argument("--name", default=None, help="Optional name for this session in the history store.")
    parser.add_argument("--export", default=None, metavar="PATH", help="Export the per-iteration score table to this CSV path.")
    parser.add_argument("--db", default=None, metavar="PATH", help="Override the SQLite history file path.")
    parser.add_argument("--runner-model", default=None)
    parser.add_argument("--optimizer-model", default=None)
    parser.add_argument("--evaluator-model", default=None)
    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> OptimizerConfig:
    return OptimizerConfig.from_env().with_overrides(
        n_iterations=args.iters,
        n_samples=args.samples,
        db_path=args.db,
        runner_model=args.runner_model,
        optimizer_model=args.optimizer_model,
        evaluator_model=args.evaluator_model,
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set. Add it to your environment or .env file.", file=sys.stderr)
        return 1

    config = build_config(args)
    client = anthropic.Anthropic()
    storage = Storage(config.db_path)

    session_id = storage.create_session(
        original_prompt=args.prompt,
        runner_model=config.runner_model,
        optimizer_model=config.optimizer_model,
        evaluator_model=config.evaluator_model,
        name=args.name,
    )
    print(f"Session #{session_id} | runner={config.runner_model} optimizer={config.optimizer_model} evaluator={config.evaluator_model}")
    print(f"Running {config.n_iterations} iteration(s) x {config.n_samples} sample(s)...\n")

    previous_score = None
    for event in optimize_prompt(client, config, args.prompt):
        etype = event["type"]

        if etype == "iteration_start":
            print(f"[Iter {event['iteration']}/{config.n_iterations}] running prompt...")

        elif etype == "scores":
            avg = event["eval_result"]["avg_total"]
            delta = "" if previous_score is None else f" (Δ {avg - previous_score:+.2f})"
            print(f"[Iter {event['iteration']}/{config.n_iterations}] score = {avg:.2f}{delta}")
            previous_score = avg

        elif etype == "rewritten":
            print(f"[Iter {event['iteration']}/{config.n_iterations}] prompt rewritten for next round")

        elif etype == "iteration_complete":
            storage.save_iteration(session_id, event["record"])

        elif etype == "done":
            history = event["history"]
            print(f"\nDone. {len(history)} iteration(s) saved to session #{session_id} ({config.db_path}).")
            if len(history) > 1:
                first, last = history[0]["avg_total"], history[-1]["avg_total"]
                print(f"Score improved {first:.2f} -> {last:.2f} (Δ {last - first:+.2f}) over {len(history)} iterations.")
            print("\nFinal prompt:\n" + "-" * 40)
            print(history[-1]["prompt"])

    if args.export:
        storage.export_csv(session_id, args.export)
        print(f"\nExported scores to {args.export}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
