"use client";

import { useState, type ReactNode } from "react";

export type TabSpec = { id: string; label: string; content: ReactNode };

/** `.tabs` / `.tab` / `.tab-panel` — underline tab strip used in the iteration detail panel. */
export function Tabs({ tabs, defaultTab }: { tabs: TabSpec[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);

  return (
    <div>
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-x-0 border-b-2 border-t-0 bg-transparent px-[18px] py-[10px] font-sans text-xs font-medium transition-colors ${
              active === tab.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} className={active === tab.id ? "p-[18px]" : "hidden"}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
