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
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import LinkIcon from "@mui/icons-material/Link";
import { captureError } from "@/lib/errors";

interface DnsRecord {
  recordType: "TXT" | "CNAME" | "A";
  name: string;
  value: string;
}

/**
 * Coerce anything the API hands back into something React can render. A payload
 * that turns out to be an object rather than a string would otherwise throw
 * "Objects are not valid as a React child" and take the whole page down, which
 * is a poor trade for one malformed field.
 */
function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** One record from the API, or null when any of its fields is unusable. */
function toDnsRecord(value: unknown): DnsRecord | null {
  return toDnsRecords([value])[0] ?? null;
}

/** Drop any record whose fields are not renderable strings. */
function toDnsRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const type = asText(entry?.recordType ?? entry?.type);
    const name = asText(entry?.name);
    const recordValue = asText(entry?.value);
    if (!type || !name || !recordValue) return [];
    return [{ recordType: type as DnsRecord["recordType"], name, value: recordValue }];
  });
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
  pointingRecord: DnsRecord | null;
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

/** Type, name and value for one record, each with its own copy button. */
function RecordFields({ record }: { record: DnsRecord }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
      <RecordRow label="Type" value={record.recordType} />
      <RecordRow label="Name" value={record.name} />
      <RecordRow label="Value" value={record.value} />
    </Box>
  );
}

/**
 * The full set of DNS work for a domain that is not live yet. Both records are
 * always shown together: showing only the ownership record leaves people
 * waiting for a domain that can never start serving traffic.
 */
function DnsSteps({
  hostname,
  txtRecord,
  pointingRecord,
}: {
  hostname: string;
  txtRecord: DnsRecord | null;
  pointingRecord: DnsRecord | null;
}) {
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Two DNS records are needed for <strong>{hostname}</strong>. Add both wherever you
        manage DNS for the domain, which is usually your registrar or DNS host. The domain
        will not go live until both exist.
      </Typography>

      {txtRecord && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>
            Step 1: prove you own the domain
          </Typography>
          <Typography variant="caption" color="text.secondary">
            A TXT record. It only proves ownership; on its own it does not make the domain
            work.
          </Typography>
          <RecordFields record={txtRecord} />
        </Box>
      )}

      {pointingRecord && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>
            Step 2: point the domain at us
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {pointingRecord.recordType === "A"
              ? "An A record on the domain itself. Many DNS providers write the domain itself as \"@\"; if yours asks for a full hostname instead, enter the domain."
              : "A CNAME record on the subdomain."}
          </Typography>
          <RecordFields record={pointingRecord} />
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" component="div">
        If your DNS runs behind a proxy such as Cloudflare, set the step 2 record to
        &ldquo;DNS only&rdquo; (the grey cloud, not the orange one). A proxied record hides
        the domain from us and verification will keep failing.
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
        DNS changes can take anywhere from a few minutes to an hour to take effect, and
        nothing happens on our side until you check.
      </Typography>
    </Box>
  );
}

type DomainMode = "shortener" | "deeplink";

/** The deeplink-relevant fields for a domain, as last confirmed by the API. */
interface DeeplinkConfig {
  mode: DomainMode;
  appLinks: { aasa: string | null; assetlinks: string | null };
  fallbackTarget: string | null;
  pathPrefix: string | null;
  updatedAt: string;
}

/**
 * Configuration form for a domain's deeplink role: mode, the two association
 * files, and the fallback target.
 *
 * On open, the dialog fetches the domain's current state from
 * GET /api/v1/domains/{hostname}, which is the authoritative source for these
 * fields. The form is neither editable nor saveable until that fetch
 * resolves: a save built on assumed-blank values could silently revert an
 * already-configured deeplink domain back to shortener mode, which is
 * exactly the bug this replaces.
 */
function DeeplinkDialog({
  hostname,
  onClose,
}: {
  hostname: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<DomainMode>("shortener");
  const [modeTouched, setModeTouched] = useState(false);
  const [aasa, setAasa] = useState("");
  const [aasaTouched, setAasaTouched] = useState(false);
  const [assetlinks, setAssetlinks] = useState("");
  const [assetlinksTouched, setAssetlinksTouched] = useState(false);
  const [fallbackTarget, setFallbackTarget] = useState("");
  const [fallbackTouched, setFallbackTouched] = useState(false);
  const [pathPrefix, setPathPrefix] = useState("");
  const [pathPrefixTouched, setPathPrefixTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    (async () => {
      try {
        const res = await fetch(`/api/v1/domains/${encodeURIComponent(hostname)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(asText(json.error, "Could not load deeplink configuration"));
          return;
        }
        const config: DeeplinkConfig = {
          mode: json.data.mode,
          appLinks: {
            aasa: json.data.appLinks?.aasa ?? null,
            assetlinks: json.data.appLinks?.assetlinks ?? null,
          },
          fallbackTarget: json.data.fallbackTarget ?? null,
          pathPrefix: json.data.pathPrefix ?? null,
          updatedAt: json.data.updatedAt,
        };
        setMode(config.mode);
        setAasa(config.appLinks.aasa ?? "");
        setAssetlinks(config.appLinks.assetlinks ?? "");
        setFallbackTarget(config.fallbackTarget ?? "");
        setPathPrefix(config.pathPrefix ?? "");
        setModeTouched(false);
        setAasaTouched(false);
        setAssetlinksTouched(false);
        setFallbackTouched(false);
        setPathPrefixTouched(false);
      } catch {
        if (!cancelled) setLoadError("Network error. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostname]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const body: Record<string, unknown> = {};
      if (modeTouched) body.mode = mode;
      const appLinks: Record<string, unknown> = {};
      if (aasaTouched) appLinks.aasa = aasa.trim() === "" ? null : aasa;
      if (assetlinksTouched) appLinks.assetlinks = assetlinks.trim() === "" ? null : assetlinks;
      if (Object.keys(appLinks).length > 0) body.appLinks = appLinks;
      if (fallbackTouched) {
        body.fallbackTarget = fallbackTarget.trim() === "" ? null : fallbackTarget.trim();
      }
      // Blank clears the prefix, matching the partial-update contract: absent
      // means unchanged, explicit null removes it.
      if (pathPrefixTouched) {
        body.pathPrefix = pathPrefix.trim() === "" ? null : pathPrefix.trim();
      }

      const res = await fetch(`/api/v1/domains/${encodeURIComponent(hostname)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(asText(json.error, "Could not save deeplink configuration"));
        return;
      }
      const config: DeeplinkConfig = {
        mode: json.data.mode,
        appLinks: {
          aasa: json.data.appLinks?.aasa ?? null,
          assetlinks: json.data.appLinks?.assetlinks ?? null,
        },
        fallbackTarget: json.data.fallbackTarget ?? null,
        pathPrefix: json.data.pathPrefix ?? null,
        updatedAt: json.data.updatedAt,
      };
      setMode(config.mode);
      setAasa(config.appLinks.aasa ?? "");
      setAssetlinks(config.appLinks.assetlinks ?? "");
      setFallbackTarget(config.fallbackTarget ?? "");
      setPathPrefix(config.pathPrefix ?? "");
      setModeTouched(false);
      setAasaTouched(false);
      setAssetlinksTouched(false);
      setFallbackTouched(false);
      setPathPrefixTouched(false);
      setSaved(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Deeplinks for {hostname}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : (
          <>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A shortener domain redirects every keyword to its target URL. A deeplink domain
          instead opens links straight inside your iOS or Android app, when the visitor has
          it installed, and only falls back to a browser otherwise.
        </Typography>

        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          onChange={(_, next) => {
            if (next) {
              setMode(next);
              setModeTouched(true);
            }
          }}
          sx={{ mb: 2 }}
          aria-label="Domain mode"
        >
          <ToggleButton value="shortener" sx={{ textTransform: "none" }}>
            Shortener
          </ToggleButton>
          <ToggleButton value="deeplink" sx={{ textTransform: "none" }}>
            Deeplink
          </ToggleButton>
        </ToggleButtonGroup>

        <TextField
          id="deeplink-path-prefix"
          label="Path prefix"
          placeholder="l"
          value={pathPrefix}
          onChange={(e) => {
            setPathPrefix(e.target.value);
            setPathPrefixTouched(true);
          }}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          helperText={`Optional. Serve your links under one extra segment, so https://${hostname}/l/abc123 resolves the link "abc123". Links at the root keep working either way. Leave blank to use the root only.`}
        />

        {mode === "deeplink" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              iOS and Android verify that this domain belongs to your app by fetching two
              files directly from it, over HTTPS, before your app is allowed to claim its
              links. Paste each file exactly as supplied by whoever manages your app: do not
              hand-edit them here, since a single misplaced character will fail
              verification silently.
            </Typography>

            <TextField
              id="deeplink-aasa"
              label="apple-app-site-association"
              placeholder='{"applinks": {"details": [...]}}'
              value={aasa}
              onChange={(e) => {
                setAasa(e.target.value);
                setAasaTouched(true);
              }}
              multiline
              minRows={5}
              maxRows={12}
              fullWidth
              slotProps={{
                htmlInput: {
                  style: { fontFamily: "var(--font-geist-mono), monospace", fontSize: 13 },
                },
              }}
              helperText="Served at /.well-known/apple-app-site-association. Leave blank if this domain does not need iOS Universal Links."
            />

            <TextField
              id="deeplink-assetlinks"
              label="assetlinks.json"
              placeholder='[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {...}}]'
              value={assetlinks}
              onChange={(e) => {
                setAssetlinks(e.target.value);
                setAssetlinksTouched(true);
              }}
              multiline
              minRows={5}
              maxRows={12}
              fullWidth
              slotProps={{
                htmlInput: {
                  style: { fontFamily: "var(--font-geist-mono), monospace", fontSize: 13 },
                },
              }}
              helperText="Served at /.well-known/assetlinks.json. Leave blank if this domain does not need Android App Links."
            />

            <Typography variant="caption" color="text.secondary">
              Apple caches whatever it first fetches from this domain on its own CDN. A
              change here can take some time to reach every device, so an error is not
              instantly fixable once Apple has cached a bad file: check the file carefully
              before saving.
            </Typography>

            <TextField
              id="deeplink-fallback"
              label="Fallback URL"
              placeholder="https://example.com/app"
              value={fallbackTarget}
              onChange={(e) => {
                setFallbackTarget(e.target.value);
                setFallbackTouched(true);
              }}
              fullWidth
              size="small"
              helperText="Where a visitor lands if the path they followed does not match any of your links. Recommended for a deeplink domain, so unmatched paths still lead somewhere sensible."
            />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {saved && !error && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSaved(false)}>
            Saved.
          </Alert>
        )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || loading || !!loadError}>
          {saving ? <CircularProgress size={20} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
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

  const [deeplinkTarget, setDeeplinkTarget] = useState<string | null>(null);

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
        setAddError(asText(json.error, "Could not add domain"));
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
          requiredRecords: toDnsRecords(json.data?.requiredRecords),
        });
      } else {
        setVerifyResult({
          hostname: target,
          outcome: "mismatch",
          message: asText(json.error, "Check failed. Try again."),
        });
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
        const match = asText(json.error).match(/(\d+) link/);
        if (res.status === 409 && match) {
          setDeleteLinkCount(Number(match[1]));
          return;
        }
        setDeleteError(asText(json.error, "Could not remove domain"));
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

  // Vercel does not always return recommended records, so fall back to the
  // domain's own pointing record. There must be no path that says "add the
  // record below" and then shows nothing.
  const provisioningRecords: DnsRecord[] = (() => {
    if (verifyResult?.outcome !== "provisioning") return [];
    if (verifyResult.requiredRecords.length > 0) return verifyResult.requiredRecords;
    const known = domains.find((d) => d.hostname === verifyResult.hostname);
    const fallback = toDnsRecord(known?.pointingRecord);
    return fallback ? [fallback] : [];
  })();

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

          {justAdded && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <DnsSteps
                hostname={asText(justAdded.hostname)}
                txtRecord={toDnsRecord(justAdded.dnsRecord)}
                pointingRecord={toDnsRecord(justAdded.pointingRecord)}
              />
              <Button
                sx={{ mt: 1 }}
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
                {provisioningRecords.length > 0
                  ? " point the domain at us with the record below, then check again."
                  : " point the domain at us with the step 2 record shown next to the domain below, then check again."}
              </Typography>
              {provisioningRecords.map((r, i) => (
                <RecordFields key={i} record={r} />
              ))}
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mt: 1 }}
              >
                If your DNS runs behind a proxy such as Cloudflare, set this record to
                &ldquo;DNS only&rdquo; (the grey cloud). A proxied record hides the domain
                from us.
              </Typography>
              <Button
                sx={{ mt: 1 }}
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
                const txtRecord = toDnsRecord(d.dnsRecord);
                const pointingRecord = toDnsRecord(d.pointingRecord);
                const showSteps = d.status !== "active" && (txtRecord || pointingRecord);
                return (
                  <Box key={d.hostname}>
                  <ListItem
                    divider={!showSteps}
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
                  {showSteps && (
                    <Box
                      sx={{
                        px: 2,
                        pb: 2,
                        borderBottom: 1,
                        borderColor: "divider",
                      }}
                    >
                      <DnsSteps
                        hostname={d.hostname}
                        txtRecord={txtRecord}
                        pointingRecord={pointingRecord}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        sx={{ mt: 1 }}
                        startIcon={
                          verifying === d.hostname ? <CircularProgress size={14} /> : <RefreshIcon />
                        }
                        disabled={verifying === d.hostname}
                        onClick={() => handleVerify(d.hostname)}
                      >
                        Check now
                      </Button>
                    </Box>
                  )}
                  </Box>
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
          onClick={() => {
            if (menuAnchor) setDeeplinkTarget(menuAnchor.hostname);
            setMenuAnchor(null);
          }}
        >
          <LinkIcon fontSize="small" sx={{ mr: 1 }} />
          Deeplinks
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

      {deeplinkTarget && (
        <DeeplinkDialog hostname={deeplinkTarget} onClose={() => setDeeplinkTarget(null)} />
      )}
    </Box>
  );
}
