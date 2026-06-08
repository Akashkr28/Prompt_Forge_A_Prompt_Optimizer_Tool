/** `.score-bar-wrap`/`.score-bar` and `.eval-bar-wrap`/`.eval-bar` — a thin
 * rounded track with a colored fill, sized by a 0–10 score or a raw percent. */
export function ScoreBar({ value, max = 10, color = "var(--color-accent-2)", height = 6 }: { value: number; max?: number; color?: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="overflow-hidden rounded-[2px] bg-cream" style={{ height }}>
      <div
        className="h-full rounded-[2px] transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
