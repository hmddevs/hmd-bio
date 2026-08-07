import Link from "next/link";
import { buildSearchIndex, buildTagGroups, spec } from "@/lib/openapi-render";
import { ApiKeyProvider } from "./ApiKeyProvider";
import DocsNav, { type NavGroup } from "./DocsNav";
import Guides from "./Guides";
import Operation from "./Operation";
import { guideSections } from "./guide-content";

/**
 * The API reference. The spec is large, so it is resolved and rendered on the
 * server: the browser receives the finished markup plus three small islands
 * (navigation and search, the code-sample tabs, the playground).
 */
export default function DocsPage() {
  const groups = buildTagGroups();
  const entries = buildSearchIndex(groups);

  const navGroups: NavGroup[] = groups.map((group) => ({
    name: group.name,
    items: group.operations.map((operation) => ({
      id: operation.id,
      method: operation.methodLabel,
      path: operation.path,
      summary: operation.summary,
      tag: group.name,
    })),
  }));

  return (
    <ApiKeyProvider>
      <div className="mx-auto w-full max-w-[100rem] px-4 md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:gap-8 lg:px-8">
        <DocsNav guides={[...guideSections]} groups={navGroups} entries={entries} />

        <main id="main-content" className="min-w-0 py-8 md:py-12">
          <header className="max-w-[70ch]">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
              API reference
            </h1>
            <p className="mt-3 leading-relaxed text-gray-600 dark:text-gray-400">
              {spec.info.description}
            </p>
            <p className="mt-3 font-mono text-xs text-gray-500 dark:text-gray-500">
              Version {spec.info.version} · OpenAPI {spec.openapi} ·{" "}
              <Link
                href="/api/docs"
                className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
              >
                raw spec
              </Link>
            </p>
          </header>

          <div className="mt-14">
            <Guides />
          </div>

          {groups.map((group) => (
            <section
              key={group.name}
              aria-labelledby={`tag-${group.name}`}
              className="mt-20 border-t border-gray-200 pt-12 dark:border-gray-800"
            >
              <h2
                id={`tag-${group.name}`}
                className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white"
              >
                {group.name}
              </h2>
              {group.description && (
                <p className="mt-2 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
                  {group.description}
                </p>
              )}
              <div className="mt-4">
                {group.operations.map((operation) => (
                  <Operation key={operation.id} operation={operation} />
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </ApiKeyProvider>
  );
}
