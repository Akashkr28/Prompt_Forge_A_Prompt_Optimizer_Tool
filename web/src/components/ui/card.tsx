import type { ReactNode } from "react";

/** `.card` — the surface every block of content sits on across the app. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface ${className}`}>
      {children}
    </div>
  );
}

/** `.card-head` — small colored dot + title + right-aligned subtitle. */
export function CardHead({
  dotColor,
  dotShape = "circle",
  title,
  sub,
  children,
}: {
  dotColor?: string;
  dotShape?: "circle" | "square";
  title?: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-[10px] border-b border-border px-[18px] py-[14px]">
      {dotColor && (
        <span
          className={`h-2 w-2 flex-shrink-0 ${dotShape === "circle" ? "rounded-full" : "rounded-[2px]"}`}
          style={{ background: dotColor }}
        />
      )}
      {title && <span className="text-xs font-semibold tracking-wide text-ink">{title}</span>}
      {children}
      {sub && <span className="ml-auto text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

/** `.card-body` */
export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-[18px] ${className}`}>{children}</div>;
}
