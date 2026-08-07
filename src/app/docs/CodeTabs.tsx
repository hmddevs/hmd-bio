"use client";

import { useId, useRef, useState } from "react";
import type { CodeSample } from "@/lib/openapi-render";
import CopyButton from "./CopyButton";

/**
 * Language tabs for an operation's code samples, following the ARIA tabs
 * pattern: arrow keys move between tabs, Home and End jump to the ends.
 */
export default function CodeTabs({ samples }: { samples: CodeSample[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = samples.length - 1;
    let next: number | undefined;

    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === undefined) return;

    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const current = samples[active];

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-800 dark:bg-black/30">
        <div role="tablist" aria-label="Code sample language" className="flex gap-1">
          {samples.map((sample, index) => (
            <button
              key={sample.language}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${sample.language}`}
              role="tab"
              type="button"
              aria-selected={index === active}
              aria-controls={`${baseId}-panel-${sample.language}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                index === active
                  ? "bg-blue-600/10 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"
                  : "text-gray-500 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200"
              }`}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <CopyButton value={current.code} srLabel={`Copy the ${current.label} sample`} />
      </div>

      <div
        id={`${baseId}-panel-${current.language}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${current.language}`}
        tabIndex={0}
        className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
      >
        <pre className="max-h-96 overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
          {current.code}
        </pre>
      </div>
    </div>
  );
}
