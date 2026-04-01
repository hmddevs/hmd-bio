"use client";

import { useState, useEffect } from "react";

interface ApiKey {
  key: string;
  label: string;
  createdAt: string;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"password" | "apikeys">("password");

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyResult, setNewKeyResult] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);

  useEffect(() => {
    if (tab === "apikeys") loadKeys();
  }, [tab]);

  async function loadKeys() {
    setKeysLoading(true);
    const res = await fetch("/api/v1/auth/api-keys");
    const data = await res.json();
    if (data.success) setApiKeys(data.data.apiKeys);
    setKeysLoading(false);
  }

  async function handlePasswordChange() {
    if (newPassword !== confirmPassword) {
      setPwMsg("Passwords do not match");
      return;
    }
    setPwSaving(true);
    setPwMsg("");
    const res = await fetch("/api/v1/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    setPwMsg(data.success ? "Password changed successfully" : data.error);
    if (data.success) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setPwSaving(false);
  }

  async function handleCreateKey() {
    if (!newKeyLabel.trim()) return;
    const res = await fetch("/api/v1/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newKeyLabel.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      setNewKeyResult(data.data.key);
      setNewKeyLabel("");
      loadKeys();
    }
  }

  async function handleDeleteKey(key: string) {
    if (!confirm("Revoke this API key?")) return;
    await fetch("/api/v1/auth/api-keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    loadKeys();
    if (newKeyResult === key) setNewKeyResult("");
  }

  const tabClass = (t: string) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition ${
      tab === t
        ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white border border-b-0 border-gray-200 dark:border-gray-800"
        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
    }`;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Settings
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button className={tabClass("password")} onClick={() => setTab("password")}>
          Change Password
        </button>
        <button className={tabClass("apikeys")} onClick={() => setTab("apikeys")}>
          API Keys
        </button>
      </div>

      {/* Password Tab */}
      {tab === "password" && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          {pwMsg && (
            <p
              className={`text-sm ${
                pwMsg.includes("success")
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-500 dark:text-red-400"
              }`}
            >
              {pwMsg}
            </p>
          )}
          <button
            onClick={handlePasswordChange}
            disabled={pwSaving}
            className="px-5 py-2.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pwSaving ? "Saving…" : "Change Password"}
          </button>
        </div>
      )}

      {/* API Keys Tab */}
      {tab === "apikeys" && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            API keys allow external services to create short URLs on your
            behalf. Include the key as a <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">X-API-Key</code> header or <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">apiKey</code> query parameter.
          </p>

          {/* Create Key */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder="Key label (e.g. Production)"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              onClick={handleCreateKey}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Create
            </button>
          </div>

          {newKeyResult && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-800 dark:text-green-300 mb-1">
                New API key created. Copy it now — it won&apos;t be shown again
                in full.
              </p>
              <code className="text-xs break-all text-green-700 dark:text-green-400">
                {newKeyResult}
              </code>
            </div>
          )}

          {/* Keys List */}
          {keysLoading ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">Loading…</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">No API keys</p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {apiKeys.map((k) => (
                <li
                  key={k.key}
                  className="py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">
                      {k.label}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                      {k.key.slice(0, 12)}…
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Created{" "}
                      {new Date(k.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteKey(k.key)}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
