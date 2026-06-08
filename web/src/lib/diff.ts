/**
 * Minimal word-level diff (LCS-based), good enough for highlighting how a
 * meta-prompting rewrite changed a prompt — the mockup's static `diff-add`/
 * `diff-del` spans, computed for real here instead of hand-authored.
 *
 * Returns two part lists already filtered for each side: `before` keeps
 * common + removed runs (render `removed` as deletions), `after` keeps
 * common + added runs (render `added` as insertions).
 */

export type DiffPart = { value: string; added?: boolean; removed?: boolean };

const MAX_CELLS = 400_000; // guards against pathological O(n*m) blowups on huge prompts

export function diffWords(a: string, b: string): { before: DiffPart[]; after: DiffPart[] } {
  const aWords = a.split(/(\s+)/).filter((w) => w.length > 0);
  const bWords = b.split(/(\s+)/).filter((w) => w.length > 0);

  if (aWords.length * bWords.length > MAX_CELLS) {
    // Too large to diff cheaply — fall back to plain (unhighlighted) text.
    return { before: [{ value: a }], after: [{ value: b }] };
  }

  const m = aWords.length;
  const n = bWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aWords[i] === bWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const merged: DiffPart[] = [];
  const push = (value: string, added?: boolean, removed?: boolean) => {
    const last = merged[merged.length - 1];
    if (last && Boolean(last.added) === Boolean(added) && Boolean(last.removed) === Boolean(removed)) {
      last.value += value;
    } else {
      merged.push({ value, added, removed });
    }
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aWords[i] === bWords[j]) {
      push(aWords[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(aWords[i], undefined, true);
      i++;
    } else {
      push(bWords[j], true);
      j++;
    }
  }
  while (i < m) push(aWords[i++], undefined, true);
  while (j < n) push(bWords[j++], true);

  return {
    before: merged.filter((p) => !p.added),
    after: merged.filter((p) => !p.removed),
  };
}
