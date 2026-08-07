"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  InputAdornment,
  CircularProgress,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Badge,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import MoreVertIcon from "@mui/icons-material/MoreVert";

type DomainStatus = "pending_dns" | "verifying" | "provisioning" | "active" | "failed" | "suspended";

interface DomainRow {
  hostname: string;
  status: DomainStatus;
  linkCount: number;
  verifiedAt: string | null;
  createdAt: string;
  failureReason: string | null;
  owner: { username: string; email: string } | null;
}

const STATUS_CHIP: Record<DomainStatus, { label: string; color: "warning" | "success" | "error" | "default" | "info" }> = {
  pending_dns: { label: "Pending DNS", color: "default" },
  verifying: { label: "Verifying", color: "info" },
  provisioning: { label: "Provisioning", color: "info" },
  active: { label: "Active", color: "success" },
  failed: { label: "Failed", color: "error" },
  suspended: { label: "Suspended", color: "warning" },
};

type TabValue = "all" | "active" | "suspended" | "pending_dns" | "failed";

export default function AdminDomainsPage() {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [total, setTotal] = useState(0);
  const [suspendedCount, setSuspendedCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabValue>("all");
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedDomain, setSelectedDomain] = useState<DomainRow | null>(null);

  // Suspend/unsuspend confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "unsuspend" | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetchDomains = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        ...(search && { search }),
        ...(tab !== "all" && { status: tab }),
      });
      const res = await fetch(`/api/v1/admin/domains?${params}`);
      const json = await res.json();
      if (json.success) {
        setDomains(json.data.domains);
        setTotal(json.data.pagination.total);
      }
    } catch {
      // Silently ignore — matches the pattern used by sibling admin pages.
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, tab]);

  const fetchSuspendedCount = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/domains?status=suspended&limit=1");
      const json = await res.json();
      if (json.success) setSuspendedCount(json.data.pagination.total);
    } catch {
      // Silently ignore.
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  useEffect(() => {
    fetchSuspendedCount();
  }, [fetchSuspendedCount]);

  const openConfirm = (action: "suspend" | "unsuspend") => {
    if (!selectedDomain) return;
    setAnchorEl(null);
    setConfirmAction(action);
    setSuspendReason("");
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!selectedDomain || !confirmAction) return;
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/domains/${selectedDomain.hostname}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: confirmAction,
          ...(confirmAction === "suspend" && suspendReason && { reason: suspendReason }),
        }),
      });
      if (res.ok) {
        setConfirmOpen(false);
        setSelectedDomain(null);
        fetchDomains();
        fetchSuspendedCount();
      }
    } catch {
      // Silently ignore — matches the pattern used by sibling admin pages.
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Domains
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => {
          setTab(v);
          setPage(0);
        }}
        sx={{ mb: 2 }}
      >
        <Tab label="All" value="all" />
        <Tab label="Active" value="active" />
        <Tab
          label={
            <Badge badgeContent={suspendedCount} color="warning" max={99}>
              Suspended
            </Badge>
          }
          value="suspended"
        />
        <Tab label="Pending DNS" value="pending_dns" />
        <Tab label="Failed" value="failed" />
      </Tabs>

      <Card sx={{ mb: 3, p: 2 }}>
        <TextField
          size="small"
          placeholder="Search by hostname…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 320 }}
        />
      </Card>

      <Card>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Hostname</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Links</TableCell>
                    <TableCell>Added</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {domains.map((d) => (
                    <TableRow key={d.hostname} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{d.hostname}</TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {d.owner ? `${d.owner.username} (${d.owner.email})` : "—"}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={STATUS_CHIP[d.status]?.label ?? d.status}
                          size="small"
                          color={STATUS_CHIP[d.status]?.color ?? "default"}
                        />
                      </TableCell>
                      <TableCell align="right">{d.linkCount}</TableCell>
                      <TableCell sx={{ color: "text.secondary", fontSize: 13 }}>
                        {new Date(d.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Actions">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              setSelectedDomain(d);
                              setAnchorEl(e.currentTarget);
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {domains.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                        No domains found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 20, 50]}
            />
          </>
        )}
      </Card>

      {/* Actions menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {selectedDomain?.status === "active" && (
          <MenuItem onClick={() => openConfirm("suspend")}>Suspend</MenuItem>
        )}
        {selectedDomain?.status === "suspended" && (
          <MenuItem onClick={() => openConfirm("unsuspend")}>Unsuspend</MenuItem>
        )}
      </Menu>

      {/* Suspend/unsuspend confirmation dialog */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {confirmAction === "suspend" ? "Suspend" : "Unsuspend"} — {selectedDomain?.hostname}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <Typography variant="body2" color="text.secondary">
            {confirmAction === "suspend"
              ? "Links on this domain will stop resolving immediately."
              : "Links on this domain will resolve again immediately."}
          </Typography>
          {confirmAction === "suspend" && (
            <TextField
              label="Reason (optional)"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={confirmAction === "suspend" ? "warning" : "primary"}
            onClick={handleConfirm}
            disabled={confirmLoading}
          >
            {confirmLoading ? <CircularProgress size={20} /> : confirmAction === "suspend" ? "Suspend" : "Unsuspend"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
