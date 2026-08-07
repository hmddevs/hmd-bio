"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copies a snippet and confirms it, both visually and to a screen reader via a
 * polite live region. The label swaps rather than animating: motion here would
 * be decoration, and the state change is itself the feedback.
 */
export default function CopyButton({
  value,
  label = "Copy",
  srLabel,
  className = "",
}: {
  value: string;
  /** Visible resting label. */
  label?: string;
  /** Accessible name, when the visible label is too terse to stand alone. */
  srLabel?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // Clipboard access can be denied outright (insecure context, permissions).
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [value]);

  const text = state === "failed" ? "Copy failed" : state === "copied" ? "Copied" : label;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={srLabel ?? label}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 ease-out hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 ${className}`}
      >
        <span aria-hidden="true">{text}</span>
      </button>
      <span role="status" className="sr-only">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "failed"
            ? "Copy failed, select the snippet and copy manually"
            : ""}
      </span>
    </>
  );
}
