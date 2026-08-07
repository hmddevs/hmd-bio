"use client";

import { useCallback, useId, useMemo, useState } from "react";
import type { PlaygroundSpec } from "@/lib/openapi-render";
import { useApiKey } from "./ApiKeyProvider";

/**
 * Sends a real request to the live API from the docs page.
 *
 * Requests go to the same origin (`/api/v1/...`), so there is no CORS work and
 * no proxy route: the browser talks to the API directly.
 *
 * The reader's key is read from context at send time and used only as the
 * Authorization header. Nothing here logs it, and nothing here calls Sentry:
 * `captureError` attaches its context verbatim as Sentry `extra`, so failures
 * are reported inline instead of being captured.
 */

/** Response headers worth surfacing; anything else is noise for a reader. */
const HEADERS_OF_INTEREST = [
  "content-type",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "cache-control",
];

interface Result {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Array<[string, string]>;
  body: string;
  bodyIsJson: boolean;
  truncated: boolean;
}

const MAX_BODY_CHARS = 20000;

function statusTone(status: number): string {
  if (status >= 500) return "text-red-600 dark:text-red-400";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  if (status >= 200 && status < 300) return "text-emerald-600 dark:text-emerald-400";
  return "text-gray-600 dark:text-gray-400";
}

export default function Playground({ spec }: { spec: PlaygroundSpec }) {
  const { apiKey } = useApiKey();
  const fieldPrefix = useId();

  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.pathParams.map((param) => [param.name, param.placeholder]))
  );
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      spec.queryParams.map((param) => [param.name, param.required ? param.placeholder : ""])
    )
  );
  const [body, setBody] = useState(spec.body ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | undefined>();
  const [error, setError] = useState<string | undefined>();

  const requestUrl = useMemo(() => {
    let path = spec.path;
    for (const param of spec.pathParams) {
      const value = pathValues[param.name]?.trim() || param.placeholder;
      path = path.replace(`{${param.name}}`, encodeURIComponent(value));
    }
    const query = new URLSearchParams();
    for (const param of spec.queryParams) {
      const value = queryValues[param.name]?.trim();
      if (value) query.set(param.name, value);
    }
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
  }, [spec, pathValues, queryValues]);

  const send = useCallback(async () => {
    setSending(true);
    setError(undefined);
    setResult(undefined);

    const headers: Record<string, string> = { Accept: "application/json, text/csv;q=0.9, */*;q=0.8" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const hasBody = spec.method !== "GET" && spec.method !== "DELETE" && body.trim().length > 0;
    if (hasBody) headers["Content-Type"] = "application/json";

    if (hasBody) {
      try {
        JSON.parse(body);
      } catch {
        setError("The request body is not valid JSON. Fix it, then send again.");
        setSending(false);
        return;
      }
    }

    const started = performance.now();
    try {
      const response = await fetch(requestUrl, {
        method: spec.method,
        headers,
        body: hasBody ? body : undefined,
        credentials: "omit",
      });
      const durationMs = Math.round(performance.now() - started);

      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();

      // Not every endpoint returns JSON: /api/v1/links/export streams CSV, and
      // an edge-level failure can return HTML. Both must render, not throw.
      let text = raw;
      let bodyIsJson = false;
      if (contentType.includes("json") && raw.trim()) {
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2);
          bodyIsJson = true;
        } catch {
          text = raw;
        }
      }

      const truncated = text.length > MAX_BODY_CHARS;

      setResult({
        status: response.status,
        statusText: response.statusText,
        durationMs,
        headers: [...response.headers.entries()]
          .filter(([name]) => HEADERS_OF_INTEREST.includes(name.toLowerCase()))
          .sort(([a], [b]) => a.localeCompare(b)),
        body: truncated ? `${text.slice(0, MAX_BODY_CHARS)}\n…` : text || "(empty response body)",
        bodyIsJson,
        truncated,
      });
    } catch (cause) {
      // A network-level failure (offline, aborted, blocked) never carries the
      // key, but keep the message to the cause's own text regardless.
      setError(
        cause instanceof Error
          ? `The request could not be sent: ${cause.message}`
          : "The request could not be sent."
      );
    } finally {
      setSending(false);
    }
  }, [apiKey, body, requestUrl, spec.method]);

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Try it</h4>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        Sends a real request to {spec.path} from this page.
      </p>

      {spec.pathParams.length > 0 && (
        <div className="mt-3 space-y-2">
          {spec.pathParams.map((param) => (
            <div key={param.name}>
              <label
                htmlFor={`${fieldPrefix}-path-${param.name}`}
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {param.name} <span className="text-gray-400 dark:text-gray-600">(path)</span>
              </label>
              <input
                id={`${fieldPrefix}-path-${param.name}`}
                value={pathValues[param.name] ?? ""}
                placeholder={param.placeholder}
                spellCheck={false}
                onChange={(event) =>
                  setPathValues((current) => ({ ...current, [param.name]: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-100"
              />
            </div>
          ))}
        </div>
      )}

      {spec.queryParams.length > 0 && (
        <div className="mt-3 space-y-2">
          {spec.queryParams.map((param) => (
            <div key={param.name}>
              <label
                htmlFor={`${fieldPrefix}-query-${param.name}`}
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {param.name}{" "}
                <span className="text-gray-400 dark:text-gray-600">
                  ({param.required ? "query, required" : "query"})
                </span>
              </label>
              <input
                id={`${fieldPrefix}-query-${param.name}`}
                value={queryValues[param.name] ?? ""}
                placeholder={param.placeholder}
                spellCheck={false}
                onChange={(event) =>
                  setQueryValues((current) => ({ ...current, [param.name]: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-100"
              />
            </div>
          ))}
        </div>
      )}

      {spec.body !== undefined && spec.method !== "GET" && (
        <div className="mt-3">
          <label
            htmlFor={`${fieldPrefix}-body`}
            className="block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Request body (JSON)
          </label>
          <textarea
            id={`${fieldPrefix}-body`}
            value={body}
            rows={Math.min(12, body.split("\n").length + 1)}
            spellCheck={false}
            onChange={(event) => setBody(event.target.value)}
            className="mt-1 w-full resize-y rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-800 dark:text-gray-100"
          />
        </div>
      )}

      <p className="mt-3 break-all font-mono text-xs text-gray-500 dark:text-gray-500">
        {spec.method} {requestUrl}
      </p>

      {spec.mutating && (
        <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          This is a {spec.method} request against the live API. It changes real data on the account
          the key belongs to. Nothing is sent until you press the button.
        </p>
      )}

      {spec.requiresAuth && !apiKey && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          No key set, so this will return 401. Paste one under{" "}
          <a
            href="#authentication"
            className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
          >
            Authentication
          </a>{" "}
          to authenticate.
        </p>
      )}

      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="mt-3 inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 ease-out hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        {sending ? "Sending…" : "Send request"}
      </button>

      <div role="status" aria-live="polite" className="mt-3">
        {error && (
          <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className={`font-mono text-sm font-semibold ${statusTone(result.status)}`}>
                {result.status} {result.statusText}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">{result.durationMs} ms</span>
              {!result.bodyIsJson && (
                <span className="text-xs text-gray-500 dark:text-gray-500">non-JSON body</span>
              )}
            </div>

            {result.headers.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-gray-200 px-3 py-2 font-mono text-[11px] dark:border-gray-800">
                {result.headers.map(([name, value]) => (
                  <div key={name} className="contents">
                    <dt className="text-gray-500 dark:text-gray-500">{name}</dt>
                    <dd className="break-all text-gray-700 dark:text-gray-300">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
              {result.body}
            </pre>
            {result.truncated && (
              <p className="px-3 pb-2 text-[11px] text-gray-500 dark:text-gray-500">
                Response truncated for display.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
