"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * Holds the reader's own API key for the "try it" playground.
 *
 * Storage rules, deliberate and not to be relaxed:
 * - React state plus `sessionStorage` only. Never `localStorage` (it survives
 *   the browser being closed on a shared machine) and never a cookie (a cookie
 *   would be sent to the server on every navigation).
 * - The key leaves this module only as the `Authorization` header of a request
 *   the reader explicitly triggers by clicking Send.
 * - It is never logged, never put in an Error message, and never handed to
 *   `captureError` (see src/lib/errors.ts: that helper attaches its context
 *   verbatim as Sentry `extra`, so a key reaching it would be uploaded). The
 *   playground therefore reports its own failures inline and calls Sentry not
 *   at all.
 */

const STORAGE_KEY = "hmd-docs-api-key";

/**
 * `sessionStorage` is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into state inside an effect. The
 * cached snapshot keeps the getter referentially stable, which the hook
 * requires.
 */
let snapshot: string | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  if (snapshot === undefined) {
    try {
      snapshot = window.sessionStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      // Storage can be blocked entirely; the key then lives in memory only.
      snapshot = "";
    }
  }
  return snapshot;
}

function getServerSnapshot(): string {
  return "";
}

function writeKey(value: string): void {
  snapshot = value;
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: an in-memory key is still usable for this page view.
  }
  for (const listener of listeners) listener();
}

interface ApiKeyContextValue {
  apiKey: string;
  setApiKey: (value: string) => void;
  clearApiKey: () => void;
}

const ApiKeyContext = createContext<ApiKeyContextValue | undefined>(undefined);

export function ApiKeyProvider({ children }: { children: React.ReactNode }) {
  const apiKey = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setApiKey = useCallback((value: string) => writeKey(value), []);
  const clearApiKey = useCallback(() => writeKey(""), []);

  const value = useMemo(
    () => ({ apiKey, setApiKey, clearApiKey }),
    [apiKey, setApiKey, clearApiKey]
  );

  return <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>;
}

export function useApiKey(): ApiKeyContextValue {
  const context = useContext(ApiKeyContext);
  if (!context) throw new Error("useApiKey must be used inside ApiKeyProvider");
  return context;
}
