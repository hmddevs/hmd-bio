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
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

interface ApiKey {
  _id: string;
  key: string;
  label: string;
  createdAt: string;
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
  const [newKeyResult, setNewKeyResult] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function loadKeys() {
    setKeysLoading(true);
    const res = await fetch("/api/v1/auth/api-keys");
    const data = await res.json();
    if (data.success) setApiKeys(data.data?.keys ?? []);
    setKeysLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on tab change
    if (tab === 1) loadKeys();
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
                Include the key as a <code>X-API-Key</code> header or <code>apiKey</code> query parameter.
              </Typography>

              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Key label (e.g. Production)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button variant="contained" size="small" onClick={handleCreateKey}>
                  Create
                </Button>
              </Box>

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
                      secondaryAction={
                        <Tooltip title="Revoke">
                          <IconButton edge="end" color="error" onClick={() => setDeleteId(k._id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={k.label}
                        secondary={
                          <>
                            <Typography variant="caption" fontFamily="monospace" component="span">
                              {k.key}
                            </Typography>
                            {" · "}
                            Created {new Date(k.createdAt).toLocaleDateString()}
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
