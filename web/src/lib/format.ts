/** Shared score/delta formatting + color rules — mirrors the mockup's
 * `.score-high/-mid/-low` and `.delta-up/-dn/-eq` classes so every screen
 * (live log, results, history table) reads scores identically. */

export function scoreTextClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-muted";
  if (score >= 7) return "text-green";
  if (score >= 5.5) return "text-gold";
  return "text-accent";
}

export function scoreBarColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "var(--color-muted)";
  if (score >= 7) return "var(--color-green)";
  if (score >= 5.5) return "var(--color-gold)";
  return "var(--color-accent)";
}

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "—" : score.toFixed(1);
}

export function formatDelta(delta: number | null | undefined): { text: string; className: string } {
  if (delta === null || delta === undefined || Number.isNaN(delta)) {
    return { text: "—", className: "text-muted" };
  }
  if (delta > 0.0049) return { text: `+${delta.toFixed(1)}`, className: "text-green" };
  if (delta < -0.0049) return { text: delta.toFixed(1), className: "text-accent" };
  return { text: "0.0", className: "text-muted" };
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function truncate(text: string, max = 90): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
