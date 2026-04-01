"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface LinkData {
  keyword: string;
  url: string;
  title: string;
  clicks: number;
  statusCode: number;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ip: string;
  createdAt: string;
}

interface Stats {
  referrers: { _id: string; count: number }[];
  countries: { _id: string; count: number }[];
  timeline: { _id: string; count: number }[];
}

export default function LinkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const keyword = params.keyword as string;

  const [link, setLink] = useState<LinkData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    url: "",
    title: "",
    statusCode: 301,
    newPassword: "",
    removePassword: false,
    expiresAt: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
  });
  const [qrSvg, setQrSvg] = useState("");

  const baseUrl = typeof window !== "undefined"
    ? window.location.origin
    : "https://hmd.bio";

  useEffect(() => {
    async function load() {
      const [linkRes, statsRes] = await Promise.all([
        fetch(`/api/v1/links/${keyword}`),
        fetch(`/api/v1/stats/${keyword}`),
      ]);
      const linkData = await linkRes.json();
      const statsData = await statsRes.json();

      if (linkData.success) {
        setLink(linkData.data);
        setForm({
          url: linkData.data.url,
          title: linkData.data.title || "",
          statusCode: linkData.data.statusCode,
          newPassword: "",
          removePassword: false,
          expiresAt: linkData.data.expiresAt
            ? linkData.data.expiresAt.slice(0, 16)
            : "",
          ogTitle: linkData.data.ogTitle || "",
          ogDescription: linkData.data.ogDescription || "",
          ogImage: linkData.data.ogImage || "",
        });
      }
      if (statsData.success) {
        setStats(statsData.data);
      }
    }
    load();
  }, [keyword]);

  async function handleSave() {
    setSaving(true);
    const body: Record<string, unknown> = {
      url: form.url,
      title: form.title,
      statusCode: form.statusCode,
      ogTitle: form.ogTitle || undefined,
      ogDescription: form.ogDescription || undefined,
      ogImage: form.ogImage || undefined,
    };
    if (form.newPassword) body.password = form.newPassword;
    if (form.removePassword) body.removePassword = true;
    if (form.expiresAt) body.expiresAt = new Date(form.expiresAt).toISOString();

    const res = await fetch(`/api/v1/links/${keyword}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      setLink(data.data);
      setEditing(false);
    }
    setSaving(false);
  }

  async function handleGenerateQr() {
    const res = await fetch(`/api/v1/links/${keyword}/qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) setQrSvg(data.data.svg);
  }

  if (!link) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/admin/links")}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-2 inline-block"
          >
            ← Back to links
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {baseUrl}/{keyword}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 truncate max-w-lg">{link.url}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGenerateQr}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            QR Code
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>

      {/* QR Code Modal */}
      {qrSvg && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              QR Code
            </h2>
            <button
              onClick={() => setQrSvg("")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          <div
            className="flex justify-center"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Clicks</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {link.clicks.toLocaleString()}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Status Code</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {link.statusCode}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Created</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {new Date(link.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Edit Link
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Destination URL
            </label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Redirect Type
              </label>
              <select
                value={form.statusCode}
                onChange={(e) =>
                  setForm({ ...form, statusCode: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value={301}>301 — Permanent</option>
                <option value={302}>302 — Temporary</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Expires At
              </label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm({ ...form, expiresAt: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Password Protection
            </label>
            {link.isPasswordProtected && (
              <label className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={form.removePassword}
                  onChange={(e) =>
                    setForm({ ...form, removePassword: e.target.checked })
                  }
                />
                Remove password
              </label>
            )}
            <input
              type="password"
              value={form.newPassword}
              onChange={(e) =>
                setForm({ ...form, newPassword: e.target.value })
              }
              placeholder={
                link.isPasswordProtected
                  ? "Change password…"
                  : "Set password…"
              }
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <hr className="border-gray-200 dark:border-gray-800" />
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Open Graph Metadata
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                OG Title
              </label>
              <input
                type="text"
                value={form.ogTitle}
                onChange={(e) =>
                  setForm({ ...form, ogTitle: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                OG Image URL
              </label>
              <input
                type="url"
                value={form.ogImage}
                onChange={(e) =>
                  setForm({ ...form, ogImage: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
              OG Description
            </label>
            <textarea
              value={form.ogDescription}
              onChange={(e) =>
                setForm({ ...form, ogDescription: e.target.value })
              }
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Analytics */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Click Timeline */}
          {stats.timeline.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:col-span-2">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
                Click Timeline (Last 30 Days)
              </h2>
              <div className="flex items-end gap-1 h-32">
                {stats.timeline.map((d) => {
                  const max = Math.max(...stats.timeline.map((t) => t.count), 1);
                  return (
                    <div
                      key={d.date}
                      className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t hover:bg-blue-600 dark:hover:bg-blue-500 transition-colors relative group"
                      style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? "2px" : "0" }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                        {d.date}: {d.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Referrers */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
              Top Referrers
            </h2>
            {stats.referrers.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 text-sm">No referrer data</p>
            ) : (
              <ul className="space-y-2">
                {stats.referrers.slice(0, 10).map((r) => (
                  <li
                    key={r._id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700 dark:text-gray-300 truncate">
                      {r._id || "Direct"}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 font-mono">
                      {r.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Countries */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
              Top Countries
            </h2>
            {stats.countries.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 text-sm">No country data</p>
            ) : (
              <ul className="space-y-2">
                {stats.countries.slice(0, 10).map((c) => (
                  <li
                    key={c._id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {c._id || "Unknown"}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 font-mono">
                      {c.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
