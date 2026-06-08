/** `.screen-header` / `.screen-eyebrow` / `.screen-title` / `.screen-sub` —
 * the eyebrow + serif title + descriptive line that opens every screen. */
export function ScreenHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="border-b border-border bg-surface px-8 pb-5 pt-7">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{eyebrow}</div>
      <h1 className="mb-1 font-serif text-[26px] font-light tracking-tight text-ink">{title}</h1>
      <p className="text-[13px] leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

/** `.screen-body` — the padded flex column every screen's content sits in. */
export function ScreenBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-1 flex-col gap-6 px-8 py-7 ${className}`}>{children}</div>;
}
