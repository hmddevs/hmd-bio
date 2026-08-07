"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Tabs,
  Tab,
  Alert,
  List,
  ListItem,
  ListItemText,
  IconButton,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Autocomplete,
  Stack,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { captureError } from "@/lib/errors";

/** The account's own domain plus the primary domain, always offered as a scoping option. */
const PRIMARY_DOMAIN = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || "hmd.bio";

type ApiKeyScope = "read" | "write" | "none";

interface ApiKey {
  _id: string;
  key: string;
  label: string;
  createdAt: string;
  scope: ApiKeyScope;
  domains: string[] | null;
  expiresAt: string | null;
  expired: boolean;
}

interface OwnedDomain {
  hostname: string;
  status: string;
}

/** Human-readable description of what a key can do, for the list row. */
function describeScope(scope: ApiKeyScope): string {
  if (scope === "write") return "Read and write";
  if (scope === "read") return "Read-only";
  return "No access";
}

export default function SettingsPage() {
  const [tab, setTab] = useState(0);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  // Defaults to read-only here, at the point where the choice is visible, even
  // though the API itself defaults to write for backwards compatibility.
  const [newKeyScope, setNewKeyScope] = useState<"read" | "write">("read");
  const [newKeyDomains, setNewKeyDomains] = useState<string[]>([]);
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [ownedDomains, setOwnedDomains] = useState<OwnedDomain[]>([]);
  const [newKeyResult, setNewKeyResult] = useState("");
  const [keyError, setKeyError] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function loadKeys() {
    setKeysLoading(true);
    const res = await fetch("/api/v1/auth/api-keys");
    const data = await res.json();
    if (data.success) setApiKeys(data.data?.keys ?? []);
    setKeysLoading(false);
  }

  async function loadOwnedDomains() {
    try {
      const res = await fetch("/api/v1/domains");
      const data = await res.json();
      if (data.success) setOwnedDomains(data.data?.domains ?? []);
    } catch (err) {
      captureError(err, { route: "admin/settings", action: "loadOwnedDomains" });
    }
  }

  useEffect(() => {
    if (tab !== 1) return;
    queueMicrotask(() => {
      loadKeys();
      loadOwnedDomains();
    });
  }, [tab]);

  async function handlePasswordChange() {
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "error", text: "Passwords do not match" });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    const res = await fetch("/api/v1/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setPwMsg({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPwMsg({ type: "error", text: data.error });
    }
    setPwSaving(false);
  }

  async function handleCreateKey() {
    if (!newKeyLabel.trim()) return;
    setKeyError("");

    let expiresAt: string | undefined;
    if (newKeyExpiry) {
      const parsed = new Date(newKeyExpiry);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        setKeyError("Expiry must be a valid date in the future");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    try {
      const res = await fetch("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newKeyLabel.trim(),
          scope: newKeyScope,
          ...(newKeyDomains.length > 0 ? { domains: newKeyDomains } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewKeyResult(data.data.key);
        setNewKeyLabel("");
        setNewKeyScope("read");
        setNewKeyDomains([]);
        setNewKeyExpiry("");
        loadKeys();
      } else {
        setKeyError(data.error || "Could not create API key");
      }
    } catch (err) {
      captureError(err, { route: "admin/settings", action: "createKey" });
      setKeyError("Network error");
    }
  }

  async function handleDeleteKey() {
    if (!deleteId) return;
    await fetch("/api/v1/auth/api-keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleteId }),
    });
    setDeleteId(null);
    setNewKeyResult("");
    loadKeys();
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Settings
      </Typography>

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", px: 2 }}>
          <Tab label="Change Password" />
          <Tab label="API Keys" />
        </Tabs>

        <CardContent>
          {/* Password Tab */}
          {tab === 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Current Password"
                type="password"
                fullWidth
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <TextField
                label="New Password"
                type="password"
                fullWidth
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <TextField
                label="Confirm New Password"
                type="password"
                fullWidth
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {pwMsg && (
                <Alert severity={pwMsg.type}>{pwMsg.text}</Alert>
              )}
              <Button
                variant="contained"
                onClick={handlePasswordChange}
                disabled={pwSaving}
                sx={{ alignSelf: "flex-start" }}
              >
                {pwSaving ? "Saving…" : "Change Password"}
              </Button>
            </Box>
          )}

          {/* API Keys Tab */}
          {tab === 1 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                API keys allow external services to create short URLs on your behalf.
                Send the key as <code>Authorization: Bearer hmd_...</code>. It is the only
                accepted channel: a key must never be put in a query string, where it would
                be recorded in access logs and referrer headers.
              </Typography>

              <Stack spacing={1.5}>
                <TextField
                  size="small"
                  placeholder="Key label (e.g. Production)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  fullWidth
                />

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Access
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={newKeyScope}
                    onChange={(_, value) => value && setNewKeyScope(value)}
                  >
                    <ToggleButton value="read">Read-only</ToggleButton>
                    <ToggleButton value="write">Read and write</ToggleButton>
                  </ToggleButtonGroup>
                </Box>

                <Autocomplete
                  multiple
                  size="small"
                  options={Array.from(
                    new Set([PRIMARY_DOMAIN, ...ownedDomains.map((d) => d.hostname)])
                  )}
                  value={newKeyDomains}
                  onChange={(_, value) => setNewKeyDomains(value)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip size="small" label={option} {...getTagProps({ index })} key={option} />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Domains"
                      placeholder={newKeyDomains.length === 0 ? "All domains" : undefined}
                      helperText="Leave empty to allow all domains you own"
                    />
                  )}
                />

                <TextField
                  size="small"
                  type="date"
                  label="Expires"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  helperText="Optional, leave blank for a key that never expires"
                  sx={{ maxWidth: 240 }}
                />

                {keyError && <Alert severity="error">{keyError}</Alert>}

                <Button variant="contained" size="small" onClick={handleCreateKey} sx={{ alignSelf: "flex-start" }}>
                  Create
                </Button>
              </Stack>

              {newKeyResult && (
                <Alert severity="success" action={
                  <Tooltip title="Copy">
                    <IconButton size="small" onClick={() => navigator.clipboard.writeText(newKeyResult)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }>
                  New API key created. Copy it now — it won&apos;t be shown again in full.
                  <Typography variant="caption" component="div" fontFamily="monospace" mt={0.5} sx={{ wordBreak: "break-all" }}>
                    {newKeyResult}
                  </Typography>
                </Alert>
              )}

              {keysLoading ? (
                <Box sx={{ textAlign: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : apiKeys.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No API keys
                </Typography>
              ) : (
                <List disablePadding>
                  {apiKeys.map((k) => (
                    <ListItem
                      key={k._id}
                      divider
                      alignItems="flex-start"
                      secondaryAction={
                        <Tooltip title="Revoke">
                          <IconButton edge="end" color="error" onClick={() => setDeleteId(k._id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                            {k.label}
                            <Chip
                              size="small"
                              label={describeScope(k.scope)}
                              color={k.scope === "write" ? "primary" : "default"}
                              variant="outlined"
                            />
                            {k.expired && <Chip size="small" label="Expired" color="error" />}
                          </Box>
                        }
                        secondary={
                          <>
                            <Typography variant="caption" fontFamily="monospace" component="span">
                              {k.key}
                            </Typography>
                            {" · "}
                            Created {new Date(k.createdAt).toLocaleDateString()}
                            {" · "}
                            {k.domains === null ? "All domains" : k.domains.join(", ")}
                            {" · "}
                            {k.expiresAt
                              ? `Expires ${new Date(k.expiresAt).toLocaleDateString()}`
                              : "Never expires"}
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>Revoke API Key</DialogTitle>
        <DialogContent>
          <Typography>
            This action cannot be undone. Any services using this key will stop working.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteKey}>
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
