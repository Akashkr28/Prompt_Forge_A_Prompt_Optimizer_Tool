"""Runner role: executes a candidate prompt N times to sample output variance.

A single run is noisy, so the pipeline averages across several samples before
handing scores to the optimizer. The samples are independent network calls, so
they're fired concurrently — that's a real latency win (close to N-fold for the
runner stage) and costs nothing in correctness since each call is stateless.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor


def run_prompt(client, model: str, prompt: str, n: int = 3, max_tokens: int = 1024) -> list[str]:
    """Run ``prompt`` against ``model`` ``n`` times and return the output texts, in order."""

    def _call(_index: int) -> str:
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    with ThreadPoolExecutor(max_workers=max(1, n)) as pool:
        return list(pool.map(_call, range(n)))
