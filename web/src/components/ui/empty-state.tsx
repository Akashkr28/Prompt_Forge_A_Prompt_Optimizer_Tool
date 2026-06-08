import type { ReactNode } from "react";

/** `.empty` — centered icon/title/sub used wherever a list has nothing in it yet. */
export function EmptyState({ icon = "○", title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-5 py-[60px] text-center text-muted">
      <div className="text-4xl opacity-30">{icon}</div>
      <div className="font-serif text-[17px] font-light text-ink">{title}</div>
      {sub && <div className="max-w-[300px] text-xs leading-relaxed">{sub}</div>}
      {action}
    </div>
  );
}
