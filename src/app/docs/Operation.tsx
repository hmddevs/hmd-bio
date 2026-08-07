import type { OperationView } from "@/lib/openapi-render";
import CodeTabs from "./CodeTabs";
import CopyButton from "./CopyButton";
import Playground from "./Playground";
import SchemaFields from "./SchemaFields";

const METHOD_TONE: Record<string, string> = {
  GET: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  POST: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  PUT: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  DELETE: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

function statusTone(status: string): string {
  const code = Number(status);
  if (code >= 500) return "text-red-600 dark:text-red-400";
  if (code >= 400) return "text-amber-600 dark:text-amber-400";
  if (code >= 200 && code < 300) return "text-emerald-600 dark:text-emerald-400";
  return "text-gray-600 dark:text-gray-400";
}

/**
 * One operation: the centre pane carries the contract, the right rail carries
 * the samples and the playground. Server-rendered apart from the two islands.
 */
export default function Operation({ operation }: { operation: OperationView }) {
  const successResponse =
    operation.responses.find((response) => response.status.startsWith("2")) ??
    operation.responses[0];

  return (
    <section
      id={operation.id}
      tabIndex={-1}
      aria-labelledby={`${operation.id}-heading`}
      className="scroll-mt-20 border-t border-gray-200 py-12 first:border-t-0 focus:outline-none dark:border-gray-800"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* Centre pane: the operation itself. */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                METHOD_TONE[operation.methodLabel] ?? "border-gray-500/30 text-gray-600"
              }`}
            >
              {operation.methodLabel}
            </span>
            <code className="min-w-0 break-all font-mono text-sm text-gray-700 dark:text-gray-300">
              {operation.path}
            </code>
            <a
              href={`#${operation.id}`}
              aria-label={`Link to ${operation.methodLabel} ${operation.path}`}
              className="rounded text-xs text-gray-400 transition-colors duration-150 ease-out hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-gray-600 dark:hover:text-blue-400"
            >
              #
            </a>
          </div>

          <h3
            id={`${operation.id}-heading`}
            className="mt-3 text-xl font-bold tracking-tight text-gray-900 dark:text-white"
          >
            {operation.summary}
          </h3>

          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{operation.authLabel}</p>

          {operation.description && (
            <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
              {operation.description}
            </p>
          )}

          {operation.parameters.length > 0 && (
            <div className="mt-8">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Parameters</h4>
              <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-800">
                {operation.parameters.map((parameter) => (
                  <li key={`${parameter.location}-${parameter.name}`} className="py-3 first:pt-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <code className="font-mono text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                        {parameter.name}
                      </code>
                      <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500">
                        {parameter.typeLabel}
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-500">
                        in {parameter.location}
                      </span>
                      {parameter.required && (
                        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          required
                        </span>
                      )}
                      {parameter.defaultValue !== undefined && (
                        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500">
                          default {parameter.defaultValue}
                        </span>
                      )}
                    </div>
                    {parameter.description && (
                      <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
                        {parameter.description}
                      </p>
                    )}
                    {(parameter.enumValues?.length || parameter.constraints.length > 0) && (
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-gray-500 dark:text-gray-500">
                        {parameter.enumValues?.length ? (
                          <span>one of: {parameter.enumValues.join(", ")}</span>
                        ) : null}
                        {parameter.constraints.map((constraint) => (
                          <span key={constraint}>{constraint}</span>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {operation.requestBody && operation.requestBody.fields.length > 0 && (
            <div className="mt-8">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                Request body
                {operation.requestBody.required && (
                  <span className="ml-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    required
                  </span>
                )}
              </h4>
              {operation.requestBody.description && (
                <p className="mt-1 max-w-[70ch] text-[13px] text-gray-600 dark:text-gray-400">
                  {operation.requestBody.description}
                </p>
              )}
              <div className="mt-3">
                <SchemaFields fields={operation.requestBody.fields} />
              </div>
            </div>
          )}

          <div className="mt-8">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Responses</h4>
            <div className="mt-3 space-y-2">
              {operation.responses.map((response) => (
                <details
                  key={response.status}
                  open={response.status.startsWith("2")}
                  className="group rounded-xl border border-gray-200 dark:border-gray-800"
                >
                  <summary className="flex cursor-pointer list-none items-baseline gap-3 rounded-xl px-3 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500">
                    <span
                      className={`font-mono text-sm font-semibold ${statusTone(response.status)}`}
                    >
                      {response.status}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] text-gray-600 dark:text-gray-400">
                      {response.description}
                    </span>
                    {response.mediaType && (
                      <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-600">
                        {response.mediaType}
                      </span>
                    )}
                  </summary>
                  {response.fields.length > 0 && (
                    <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
                      <SchemaFields fields={response.fields} />
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail: samples, example response, and the live playground. */}
        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <CodeTabs samples={operation.samples} />

          {successResponse?.example && (
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-black/30">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Example response{" "}
                  <span className={`font-mono ${statusTone(successResponse.status)}`}>
                    {successResponse.status}
                  </span>
                </span>
                <CopyButton
                  value={successResponse.example}
                  srLabel="Copy the example response"
                />
              </div>
              <pre className="max-h-96 overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
                {successResponse.example}
              </pre>
            </div>
          )}

          <Playground spec={operation.playground} />
        </div>
      </div>
    </section>
  );
}
