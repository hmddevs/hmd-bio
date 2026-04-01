"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface LinkItem {
  _id: string;
  keyword: string;
  url: string;
  title: string;
  clicks: number;
  statusCode: number;
  isPasswordProtected: boolean;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, limit: 15, total: 0, totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);

  const baseUrl = typeof window !== "undefined"
    ? window.location.origin
    : "https://hmd.bio";

  const fetchLinks = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "15",
      sort,
      order,
      ...(search ? { search } : {}),
    });

    try {
      const res = await fetch(`/api/v1/links?${params}`);
      const data = await res.json();
      if (data.success) {
        setLinks(data.data.links);
        setPagination(data.data.pagination);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [search, sort, order]);

  useEffect(() => {
    fetchLinks(1);
  }, [fetchLinks]);

  async function handleDelete(keyword: string) {
    if (!confirm(`Delete hmd.bio/${keyword}? This cannot be undone.`)) return;

    const res = await fetch(`/api/v1/links/${keyword}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      fetchLinks(pagination.page);
    }
  }

  function handleSort(field: string) {
    if (sort === field) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      setOrder("desc");
    }
  }

  const SortIcon = ({ field }: { field: string }) => (
    <span className="ml-1 text-gray-400 dark:text-gray-500">
      {sort === field ? (order === "asc" ? "↑" : "↓") : ""}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Links
        </h1>
        <div className="flex gap-2">
          <a
            href="/api/v1/links/export"
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search keywords, URLs, titles…"
          className="w-full max-w-md px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                <th
                  className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none"
                  onClick={() => handleSort("keyword")}
                >
                  Short URL <SortIcon field="keyword" />
                </th>
                <th
                  className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none"
                  onClick={() => handleSort("url")}
                >
                  Destination <SortIcon field="url" />
                </th>
                <th
                  className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none"
                  onClick={() => handleSort("clicks")}
                >
                  Clicks <SortIcon field="clicks" />
                </th>
                <th
                  className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none"
                  onClick={() => handleSort("createdAt")}
                >
                  Created <SortIcon field="createdAt" />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : links.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    No links found
                  </td>
                </tr>
              ) : (
                links.map((link) => (
                  <tr
                    key={link._id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/links/${link.keyword}`}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {baseUrl}/{link.keyword}
                      </Link>
                      <div className="flex gap-1 mt-0.5">
                        {link.statusCode === 302 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                            302
                          </span>
                        )}
                        {link.isPasswordProtected && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                            🔒
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-gray-700 dark:text-gray-300">
                        {link.title || link.url}
                      </p>
                      <p className="truncate text-xs text-gray-400 dark:text-gray-500">
                        {link.url}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-300">
                      {link.clicks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {new Date(link.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(link.keyword)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pagination.total} links total
            </p>
            <div className="flex gap-2">
              <button
                disabled={pagination.page === 1}
                onClick={() => fetchLinks(pagination.page - 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                disabled={pagination.page === pagination.totalPages}
                onClick={() => fetchLinks(pagination.page + 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
