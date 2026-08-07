"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchEntry } from "@/lib/openapi-render";

/**
 * Cmd-K / Ctrl-K command palette over the endpoint list. Matches on method,
 * path, summary and tag; every term in the query has to match somewhere.
 */
export default function SearchPalette({
  entries,
  open,
  onClose,
}: {
  entries: SearchEntry[];
  open: boolean;
  onClose: () => void;
}) {
  // Mounted only while open, so the query and highlight reset themselves
  // without an effect copying "closed" back into state.
  if (!open) return null;
  return <Palette entries={entries} onClose={onClose} />;
}

function Palette({ entries, onClose }: { entries: SearchEntry[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigated = useRef(false);
  const listId = useId();
  const titleId = useId();

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return entries.slice(0, 30);

    return entries
      .filter((entry) => {
        const haystack =
          `${entry.method} ${entry.path} ${entry.summary} ${entry.tag}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 30);
  }, [entries, query]);

  // Take focus on mount and hand it back to whatever opened the palette, unless
  // the reader picked a result: focus belongs on the endpoint they chose.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (!navigated.current) opener?.focus();
    };
  }, []);

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const go = useCallback(
    (entry: SearchEntry | undefined) => {
      if (!entry) return;
      const target = document.getElementById(entry.id);
      navigated.current = Boolean(target);
      onClose();
      if (!target) return;
      window.history.replaceState(null, "", `#${entry.id}`);
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    },
    [onClose]
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // The dialog has exactly one focusable child, so holding focus inside is
      // a matter of refusing to hand it back to the page behind.
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[highlighted]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* The one deliberate shadow in the system: a floating search dialog. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl motion-safe:animate-[docs-pop_150ms_ease-out] dark:border-gray-800 dark:bg-[#141414]"
      >
        <h2 id={titleId} className="sr-only">
          Search the API reference
        </h2>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[highlighted] ? `${listId}-${results[highlighted].id}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search endpoints by method, path or summary"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          className="w-full border-b border-gray-200 bg-transparent px-4 py-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:border-gray-800 dark:text-gray-100"
        />

        <ul ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-500">
              No endpoint matches that.
            </li>
          )}
          {results.map((entry, index) => (
            <li
              key={entry.id}
              id={`${listId}-${entry.id}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseMove={() => setHighlighted(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                go(entry);
              }}
              className={`flex cursor-pointer items-baseline gap-3 px-4 py-2 ${
                index === highlighted ? "bg-blue-600/10 dark:bg-blue-400/10" : ""
              }`}
            >
              <span className="w-14 shrink-0 font-mono text-[10px] font-semibold text-gray-500 dark:text-gray-500">
                {entry.method}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-gray-900 dark:text-gray-100">
                  {entry.path}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-500">
                  {entry.summary}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-600">{entry.tag}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
