"use client";

import { useId, useState } from "react";
import { useApiKey } from "./ApiKeyProvider";

/**
 * Where the reader pastes their key for the playground. Rendered once, in the
 * Authentication guide; every playground on the page reads the same context.
 */
export default function ApiKeyField() {
  const { apiKey, setApiKey, clearApiKey } = useApiKey();
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const hintId = useId();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#141414]">
      <label htmlFor={inputId} className="block text-sm font-semibold text-gray-900 dark:text-white">
        Your API key
      </label>
      <p id={hintId} className="mt-1 max-w-[65ch] text-sm text-gray-600 dark:text-gray-400">
        Paste a key to use the &quot;Send request&quot; control on any endpoint below. It is kept in
        this tab only, in <code className="font-mono text-xs">sessionStorage</code>, and is sent
        nowhere except the <code className="font-mono text-xs">Authorization</code> header of a
        request you trigger yourself. Closing the tab discards it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          aria-describedby={hintId}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder="hmd_..."
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value.trim())}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-100"
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors duration-150 ease-out hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {revealed ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={clearApiKey}
          disabled={!apiKey}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors duration-150 ease-out hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Clear key
        </button>
      </div>
    </div>
  );
}
