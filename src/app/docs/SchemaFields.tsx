import type { SchemaField } from "@/lib/openapi-render";

/**
 * Renders a schema as a nested definition list. Server-rendered: the shape of a
 * request or response never changes at runtime, so none of this needs to be
 * shipped as component code to the browser.
 */
export default function SchemaFields({
  fields,
  depth = 0,
}: {
  fields: SchemaField[];
  depth?: number;
}) {
  if (fields.length === 0) return null;

  return (
    <ul
      className={
        depth === 0
          ? "divide-y divide-gray-200 dark:divide-gray-800"
          : "mt-2 space-y-2 border-l border-gray-200 pl-4 dark:border-gray-800"
      }
    >
      {fields.map((field) => (
        <li key={field.name} className={depth === 0 ? "py-3 first:pt-0 last:pb-0" : ""}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="font-mono text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              {field.name}
            </code>
            <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500">
              {field.typeLabel}
            </span>
            {field.required && (
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                required
              </span>
            )}
            {field.defaultValue !== undefined && (
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500">
                default {field.defaultValue}
              </span>
            )}
          </div>

          {field.description && (
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
              {field.description}
            </p>
          )}

          {(field.enumValues?.length || field.constraints.length > 0) && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-gray-500 dark:text-gray-500">
              {field.enumValues?.length ? <span>one of: {field.enumValues.join(", ")}</span> : null}
              {field.constraints.map((constraint) => (
                <span key={constraint}>{constraint}</span>
              ))}
            </p>
          )}

          <SchemaFields fields={field.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}
