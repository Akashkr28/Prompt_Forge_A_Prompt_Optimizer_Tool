"""Meta-prompting template: instructs the optimizer LLM to rewrite a prompt
using sample outputs and evaluator scores as feedback."""

META_PROMPT = """\
You are an expert prompt engineer. Your job is to improve the prompt below.

## Original Prompt
{original_prompt}

## Sample Outputs (from {n_samples} test runs)
{sample_outputs}

## Evaluator Scores
{eval_scores}

## Instructions
Analyze what's wrong with the prompt based on the sample outputs and scores above.
Then rewrite it to:
1. Be clearer and more specific
2. Remove ambiguity that causes inconsistent outputs
3. Add examples or constraints if useful
4. Preserve the original intent and the kind of task it asks for

Return ONLY the improved prompt text. No preamble, no explanation, no markdown
code fences — just the prompt itself.
"""


def build_meta_prompt(
    original_prompt: str,
    sample_outputs: list[str],
    eval_scores: str,
    n_samples: int,
) -> str:
    """Fill in the meta-prompt template for one optimizer call."""
    joined_outputs = "\n---\n".join(sample_outputs)
    return META_PROMPT.format(
        original_prompt=original_prompt,
        sample_outputs=joined_outputs,
        eval_scores=eval_scores,
        n_samples=n_samples,
    )
