"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchEntry } from "@/lib/openapi-render";
import SearchPalette from "./SearchPalette";
import { useActiveSection } from "./useActiveSection";

export interface NavGroup {
  name: string;
  items: SearchEntry[];
}

export interface NavGuide {
  id: string;
  label: string;
}

const METHOD_TONE: Record<string, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-amber-600 dark:text-amber-400",
  DELETE: "text-red-600 dark:text-red-400",
};

/**
 * Left-hand navigation: guides first, then endpoints grouped by OpenAPI tag.
 * Sticky from md up, a slide-in drawer below it.
 */
export default function DocsNav({
  guides,
  groups,
  entries,
}: {
  guides: NavGuide[];
  groups: NavGroup[];
  entries: SearchEntry[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const sectionIds = useMemo(
    () => [...guides.map((guide) => guide.id), ...groups.flatMap((g) => g.items.map((i) => i.id))],
    [guides, groups]
  );
  const active = useActiveSection(sectionIds);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The drawer overlays the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const tree = (
    <nav aria-label="API reference" className="text-sm">
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="mb-5 flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-500 transition-colors duration-150 ease-out hover:border-gray-300 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-500 dark:hover:border-gray-700 dark:hover:text-gray-300"
      >
        <span>Search endpoints</span>
        <kbd className="rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:border-gray-800">
          ⌘K
        </kbd>
      </button>

      <p className="mb-2 text-xs font-semibold tracking-wide text-gray-900 dark:text-white">Guides</p>
      <ul className="mb-6 space-y-0.5">
        {guides.map((guide) => (
          <li key={guide.id}>
            <NavLink href={`#${guide.id}`} active={active === guide.id} onNavigate={closeDrawer}>
              {guide.label}
            </NavLink>
          </li>
        ))}
      </ul>

      {groups.map((group) => (
        <div key={group.name} className="mb-6">
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-900 dark:text-white">
            {group.name}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <NavLink href={`#${item.id}`} active={active === item.id} onNavigate={closeDrawer}>
                  <span
                    className={`mr-2 inline-block w-11 shrink-0 font-mono text-[10px] font-semibold ${
                      METHOD_TONE[item.method] ?? "text-gray-500"
                    }`}
                  >
                    {item.method}
                  </span>
                  <span className="truncate">{item.summary}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 border-b border-gray-200 bg-[var(--background)]/95 px-4 py-2.5 backdrop-blur md:hidden dark:border-gray-800">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="docs-nav-drawer"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-300"
        >
          Contents
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-300"
        >
          Search
        </button>
      </div>

      <aside className="hidden md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto md:py-8 md:pr-6">
        {tree}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            id="docs-nav-drawer"
            className="absolute inset-y-0 left-0 w-[19rem] max-w-[85vw] overflow-y-auto border-r border-gray-200 bg-white p-5 motion-safe:animate-[docs-slide-in_180ms_ease-out] dark:border-gray-800 dark:bg-[#141414]"
          >
            <button
              type="button"
              onClick={closeDrawer}
              className="mb-4 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-300"
            >
              Close
            </button>
            {tree}
          </div>
        </div>
      )}

      <SearchPalette entries={entries} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function NavLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "location" : undefined}
      className={`flex items-baseline rounded-md px-2 py-1 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        active
          ? "bg-blue-600/10 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"
          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      }`}
    >
      {children}
    </Link>
  );
}
