"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  IconButton,
  CircularProgress,
  Tooltip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import { captureError } from "@/lib/errors";

interface DnsRecord {
  recordType: "TXT" | "CNAME" | "A";
  name: string;
  value: string;
}

type DomainStatus =
  | "pending_dns"
  | "verifying"
  | "provisioning"
  | "active"
  | "failed"
  | "suspended";

interface DomainItem {
  hostname: string;
  status: DomainStatus;
  verifiedAt: string | null;
  linkCount: number;
  failureReason: string | null;
  createdAt: string;
  dnsRecord: DnsRecord | null;
}

const STATUS_META: Record<DomainStatus, { label: string; color: "default" | "info" | "warning" | "success" | "error" }> = {
  pending_dns: { label: "Pending DNS", color: "warning" },
  verifying: { label: "Verifying", color: "info" },
  provisioning: { label: "Provisioning", color: "info" },
  active: { label: "Active", color: "success" },
  failed: { label: "Failed", color: "error" },
  suspended: { label: "Suspended", color: "error" },
};

/** A single DNS record row with a label, a mono value, and a copy button. */
function RecordRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontFamily="var(--font-geist-mono), monospace"
        sx={{ wordBreak: "break-all", flex: 1 }}
      >
        {value}
      </Typography>
      <Tooltip title={copied ? "Copied" : "Copy"}>
        <IconButton
          size="small"
          aria-label={`Copy ${label} value`}
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <ContentCopyIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [limit, setLimit] = useState(3);
  const [loading, setLoading] = useState(true);

  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [justAdded, setJustAdded] = useState<DomainItem | null>(null);

  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; hostname: string } | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    | { hostname: string; outcome: "active" }
    | { hostname: string; outcome: "provisioning"; requiredRecords: DnsRecord[] }
    | { hostname: string; outcome: "mismatch"; message: string }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteLinkCount, setDeleteLinkCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/domains");
      const json = await res.json();
      if (json.success) {
        setDomains(json.data.domains);
        setLimit(json.data.limit);
      }
    } catch (err) {
      captureError(err, { route: "dashboard/domains", action: "loadDomains" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  async function handleAdd() {
    if (!hostname.trim()) return;
    setAdding(true);
    setAddError("");
    setJustAdded(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: hostname.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error || "Could not add domain");
        return;
      }
      setJustAdded(json.data);
      setHostname("");
      loadDomains();
    } catch {
      setAddError("Network error. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleVerify(target: string) {
    setVerifying(target);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(target)}/verify`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.status === 200) {
        setVerifyResult({ hostname: target, outcome: "active" });
      } else if (res.status === 202) {
        setVerifyResult({
          hostname: target,
          outcome: "provisioning",
          requiredRecords: json.data?.requiredRecords ?? [],
        });
      } else if (res.status === 400) {
        setVerifyResult({ hostname: target, outcome: "mismatch", message: json.error });
      } else {
        setVerifyResult({ hostname: target, outcome: "mismatch", message: json.error || "Check failed. Try again." });
      }
      loadDomains();
    } catch {
      setVerifyResult({ hostname: target, outcome: "mismatch", message: "Network error. Please try again." });
    } finally {
      setVerifying(null);
    }
  }

  async function handleDelete(force: boolean) {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(
        `/api/v1/domains/${encodeURIComponent(deleteTarget)}${force ? "?force=true" : ""}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) {
        // 409 carries the link count in the message; surface it and offer force.
        const match = json.error?.match(/(\d+) link/);
        if (res.status === 409 && match) {
          setDeleteLinkCount(Number(match[1]));
          return;
        }
        setDeleteError(json.error || "Could not remove domain");
        return;
      }
      setDeleteTarget(null);
      setDeleteLinkCount(null);
      loadDomains();
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const activeMenuDomain = domains.find((d) => d.hostname === menuAnchor?.hostname);

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="h5" fontWeight={700} mb={1}>
        Domains
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Attach your own domain to create short links on it, alongside hmd.bio.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Add a domain
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
            <TextField
              size="small"
              label="Domain"
              placeholder="go.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button variant="contained" onClick={handleAdd} disabled={adding || !hostname.trim()}>
              {adding ? <CircularProgress size={20} /> : "Add"}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            You can attach up to {limit} domains. {domains.length}/{limit} used.
          </Typography>

          {addError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {addError}
            </Alert>
          )}

          {justAdded?.dnsRecord && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Add this TXT record wherever you manage DNS for <strong>{justAdded.hostname}</strong>
                {" "}(your domain registrar or DNS host). It proves you own the domain. DNS changes
                can take anywhere from a few minutes to an hour to take effect, and nothing happens
                on our side until you press &ldquo;Check now&rdquo; below.
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
                <RecordRow label="Type" value={justAdded.dnsRecord.recordType} />
                <RecordRow label="Name" value={justAdded.dnsRecord.name} />
                <RecordRow label="Value" value={justAdded.dnsRecord.value} />
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={verifying === justAdded.hostname ? <CircularProgress size={14} /> : <RefreshIcon />}
                disabled={verifying === justAdded.hostname}
                onClick={() => handleVerify(justAdded.hostname)}
              >
                Check now
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>

      {verifyResult && (
        <Alert
          severity={
            verifyResult.outcome === "active"
              ? "success"
              : verifyResult.outcome === "provisioning"
                ? "info"
                : "warning"
          }
          sx={{ mb: 2 }}
          onClose={() => setVerifyResult(null)}
        >
          {verifyResult.outcome === "active" && (
            <Typography variant="body2">
              <strong>{verifyResult.hostname}</strong> is verified and live.
            </Typography>
          )}
          {verifyResult.outcome === "provisioning" && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Ownership of <strong>{verifyResult.hostname}</strong> is confirmed. One more step:
                point the domain at us by adding the record below, then check again.
              </Typography>
              {verifyResult.requiredRecords.map((r, i) => (
                <Box key={i} sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
                  <RecordRow label="Type" value={r.recordType} />
                  <RecordRow label="Name" value={r.name} />
                  <RecordRow label="Value" value={r.value} />
                </Box>
              ))}
              <Button
                size="small"
                variant="outlined"
                startIcon={verifying === verifyResult.hostname ? <CircularProgress size={14} /> : <RefreshIcon />}
                disabled={verifying === verifyResult.hostname}
                onClick={() => handleVerify(verifyResult.hostname)}
              >
                Check again
              </Button>
            </Box>
          )}
          {verifyResult.outcome === "mismatch" && (
            <Typography variant="body2">
              {verifyResult.message} DNS changes are not always instant, so this does not
              necessarily mean anything is wrong: wait a little longer and check again.
            </Typography>
          )}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Your domains
          </Typography>
          {loading ? (
            <Box sx={{ textAlign: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : domains.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No domains attached yet.
            </Typography>
          ) : (
            <List disablePadding>
              {domains.map((d) => {
                const meta = STATUS_META[d.status];
                return (
                  <ListItem
                    key={d.hostname}
                    divider
                    secondaryAction={
                      <IconButton
                        edge="end"
                        aria-label={`Actions for ${d.hostname}`}
                        onClick={(e) => setMenuAnchor({ el: e.currentTarget, hostname: d.hostname })}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <Typography variant="body2" fontWeight={500}>
                            {d.hostname}
                          </Typography>
                          <Chip label={meta.label} color={meta.color} size="small" />
                        </Box>
                      }
                      secondary={
                        <>
                          {d.linkCount} link{d.linkCount === 1 ? "" : "s"} · Added{" "}
                          {new Date(d.createdAt).toLocaleDateString()}
                          {d.failureReason && (
                            <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                              {d.failureReason}
                            </Typography>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </CardContent>
      </Card>

      <Menu
        anchorEl={menuAnchor?.el ?? null}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          disabled={activeMenuDomain?.status === "active" || verifying === menuAnchor?.hostname}
          onClick={() => {
            if (menuAnchor) handleVerify(menuAnchor.hostname);
            setMenuAnchor(null);
          }}
        >
          Verify
        </MenuItem>
        <MenuItem
          disabled={!activeMenuDomain?.dnsRecord}
          onClick={() => {
            if (activeMenuDomain?.dnsRecord) {
              navigator.clipboard.writeText(activeMenuDomain.dnsRecord.value);
            }
            setMenuAnchor(null);
          }}
        >
          Copy DNS record
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menuAnchor) {
              setDeleteTarget(menuAnchor.hostname);
              setDeleteError("");
              setDeleteLinkCount(null);
            }
            setMenuAnchor(null);
          }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

      <Dialog
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteLinkCount(null);
        }}
      >
        <DialogTitle>Remove domain</DialogTitle>
        <DialogContent>
          {deleteLinkCount === null ? (
            <Typography>
              Remove <strong>{deleteTarget}</strong>? This cannot be undone.
            </Typography>
          ) : (
            <Typography>
              <strong>{deleteTarget}</strong> still has {deleteLinkCount} link
              {deleteLinkCount === 1 ? "" : "s"}. They will stop resolving if you remove the
              domain; the links themselves are kept. Remove anyway?
            </Typography>
          )}
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteTarget(null);
              setDeleteLinkCount(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={() => handleDelete(deleteLinkCount !== null)}
          >
            {deleting ? <CircularProgress size={18} /> : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
