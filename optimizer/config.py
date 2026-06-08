"""Runtime configuration for the optimizer, loaded from environment / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace

from dotenv import load_dotenv

load_dotenv()

# Cost/quality split: the evaluator runs once per sample per iteration (the
# highest call volume in the loop), so it defaults to a cheaper, faster model
# than the runner and optimizer roles, which need stronger reasoning.
DEFAULT_RUNNER_MODEL = "claude-sonnet-4-6"
DEFAULT_OPTIMIZER_MODEL = "claude-sonnet-4-6"
DEFAULT_EVALUATOR_MODEL = "claude-haiku-4-5-20251001"


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class OptimizerConfig:
    """Knobs for a single optimization run.

    Construct with :meth:`from_env` to pick up `.env` / environment overrides,
    then use `dataclasses.replace` (or :meth:`with_overrides`) to layer CLI /
    UI choices on top.
    """

    runner_model: str = DEFAULT_RUNNER_MODEL
    optimizer_model: str = DEFAULT_OPTIMIZER_MODEL
    evaluator_model: str = DEFAULT_EVALUATOR_MODEL

    n_samples: int = 3
    n_iterations: int = 5

    runner_max_tokens: int = 1024
    optimizer_max_tokens: int = 1024
    evaluator_max_tokens: int = 512

    db_path: str = "optimizer_history.db"

    @classmethod
    def from_env(cls) -> "OptimizerConfig":
        return cls(
            runner_model=os.environ.get("OPTIMIZER_RUNNER_MODEL", DEFAULT_RUNNER_MODEL),
            optimizer_model=os.environ.get("OPTIMIZER_OPTIMIZER_MODEL", DEFAULT_OPTIMIZER_MODEL),
            evaluator_model=os.environ.get("OPTIMIZER_EVALUATOR_MODEL", DEFAULT_EVALUATOR_MODEL),
            n_samples=_env_int("OPTIMIZER_N_SAMPLES", 3),
            n_iterations=_env_int("OPTIMIZER_N_ITERATIONS", 5),
            db_path=os.environ.get("OPTIMIZER_DB_PATH", "optimizer_history.db"),
        )

    def with_overrides(self, **kwargs) -> "OptimizerConfig":
        """Return a copy with only the non-None keyword overrides applied."""
        overrides = {k: v for k, v in kwargs.items() if v is not None}
        return replace(self, **overrides)
