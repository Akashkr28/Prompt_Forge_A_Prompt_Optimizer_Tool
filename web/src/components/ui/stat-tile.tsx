import type { ReactNode } from "react";

/** `.stat-tile` — big serif number over a small mono label, used in stat rows. */
export function StatTile({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-[3px] font-serif text-[28px] font-light leading-none tracking-tight text-ink" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="font-mono text-[10px] tracking-[0.05em] text-muted">{label}</div>
    </div>
  );
}
