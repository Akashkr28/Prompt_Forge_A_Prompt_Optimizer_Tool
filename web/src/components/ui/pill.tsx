type Status = "done" | "running" | "failed";

const styles: Record<Status, string> = {
  done: "bg-[#e6f9ef] text-[#1a7a40]",
  running: "bg-[#fff3e0] text-[#b05000]",
  failed: "bg-[#fde8e4] text-[#a02020]",
};

/** `.pill` / `.pill-done` / `.pill-run` / `.pill-fail` — status chip used in the history table. */
export function Pill({ status, label }: { status: Status; label?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${styles[status]}`}>
      {label ?? status}
    </span>
  );
}

type IterBadgeKind = "best" | "latest" | "running" | "done";

const badgeStyles: Record<IterBadgeKind, string> = {
  best: "bg-[#e6f9ef] text-[#1a7a40]",
  latest: "bg-[#e8eeff] text-[#2a4ab0]",
  running: "bg-[#e8eeff] text-[#2a4ab0]",
  done: "bg-cream text-muted",
};

/** `.iter-badge` / `.ib-best` / `.ib-curr` / `.ib-done` — small badge in iteration rows. */
export function IterBadge({ kind }: { kind: IterBadgeKind }) {
  return (
    <span className={`rounded-[3px] px-[7px] py-0.5 font-mono text-[9px] font-medium tracking-[0.04em] ${badgeStyles[kind]}`}>
      {kind}
    </span>
  );
}
