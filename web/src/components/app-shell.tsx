"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Config } from "@/lib/api";

type NavItem = { href: string; label: string };
type NavGroup = { section: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    section: "Workspace",
    items: [
      { href: "/", label: "Prompt Optimizer" },
      { href: "/results", label: "Results & Analysis" },
      { href: "/history", label: "Session History" },
    ],
  },
  {
    section: "Configuration",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The shell every screen lives inside: a dark sticky topbar (logo, live API
 * status, active model) over a sticky sidebar + scrollable main pane — exactly
 * the `.app` grid from the mockup, translated to Tailwind and wired to the
 * real `/api/config` endpoint instead of static badges.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* topbar degrades gracefully if the API isn't reachable yet */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid min-h-screen grid-rows-[56px_1fr] md:grid-cols-[240px_1fr]">
      {/* ─── Topbar ─── */}
      <header className="sticky top-0 z-[100] col-span-full flex h-14 items-center gap-4 border-b border-ink-line bg-ink px-6">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg italic tracking-tight text-paper">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent text-xs font-semibold not-italic text-white">
            ⟳
          </span>
          PromptForge
        </Link>
        <div className="mx-1 hidden h-5 w-px bg-ink-line sm:block" />
        <span className="hidden font-mono text-[11px] text-[#444] sm:inline">Automated Prompt Optimizer</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`rounded-[3px] px-2 py-[3px] font-mono text-[10px] tracking-[0.04em] ${
              config?.api_key_configured ? "bg-[#0a2a18] text-green" : "bg-ink-line text-[#666]"
            }`}
          >
            {config ? (config.api_key_configured ? "● API connected" : "● API key missing") : "● checking…"}
          </span>
          {config && (
            <span className="hidden rounded-[3px] bg-ink-line px-2 py-[3px] font-mono text-[10px] tracking-[0.04em] text-[#666] md:inline">
              {config.optimizer_model}
            </span>
          )}
          <a
            href="https://github.com/anthropics/anthropic-sdk-python#readme"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[#2a2a2a] px-3 py-[5px] font-sans text-[11px] font-medium text-[#888] transition-colors hover:bg-[#1e2025] hover:text-[#ccc]"
          >
            Docs
          </a>
        </div>
      </header>

      {/* ─── Sidebar ─── */}
      <nav className="sticky top-14 hidden h-[calc(100vh-56px)] flex-col gap-1 overflow-y-auto border-r border-ink-line bg-ink py-4 md:flex">
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="px-[18px] pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[#444]">
              {group.section}
            </div>
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-[10px] border-l-2 px-[18px] py-2 font-sans text-[13px] transition-colors ${
                    active
                      ? "border-accent bg-[#141518] text-paper"
                      : "border-transparent text-[#888] hover:bg-[#141518] hover:text-[#ccc]"
                  }`}
                >
                  <span
                    className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                      active ? "bg-accent opacity-100" : "bg-current opacity-40"
                    }`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ─── Main ─── */}
      <main className="flex flex-col overflow-y-auto bg-paper">{children}</main>
    </div>
  );
}
