"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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

interface UserRow {
  _id: string;
  username: string;
  email: string;
  role: string;
  isVerified: boolean;
  status: "pending" | "approved" | "disabled";
  linkCount: number;
  createdAt: string;
}

const STATUS_CHIP: Record<string, { label: string; color: "warning" | "success" | "error" | "default" }> = {
  pending: { label: "Pending", color: "warning" },
  approved: { label: "Approved", color: "success" },
  disabled: { label: "Disabled", color: "error" },
};

type TabValue = "all" | "pending" | "approved" | "disabled";

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabValue>("all");
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        ...(search && { search }),
        ...(tab !== "all" && { status: tab }),
      });
      const res = await fetch(`/api/v1/admin/users?${params}`);
      const json = await res.json();
      if (json.success) {
        setUsers(json.data.users);
        setTotal(json.data.pagination.total);
      }
    } catch (err) {
      console.error("Fetch users error:", err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, tab]);

  // Fetch pending count for tab badge
  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/users?status=pending&limit=1");
      const json = await res.json();
      if (json.success) setPendingCount(json.data.pagination.total);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchPendingCount();
  }, [fetchPendingCount]);

  const handleAction = async (action: string) => {
    if (!selectedUser) return;
    setAnchorEl(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${selectedUser._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        fetchUsers();
        fetchPendingCount();
      }
    } catch (err) {
      console.error("User action error:", err);
    }
  };

  const openEdit = () => {
    if (!selectedUser) return;
    setAnchorEl(null);
    setEditUsername(selectedUser.username);
    setEditEmail(selectedUser.email);
    setEditError("");
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedUser) return;
    setEditLoading(true);
    setEditError("");
    try {
      const res = await fetch(`/api/v1/admin/users/${selectedUser._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "editProfile",
          username: editUsername,
          email: editEmail,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error || "Failed to update");
        return;
      }
      setEditOpen(false);
      fetchUsers();
    } catch {
      setEditError("Network error");
    } finally {
      setEditLoading(false);
    }
  };

  const openDelete = () => {
    if (!selectedUser) return;
    setAnchorEl(null);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${selectedUser._id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteOpen(false);
        setSelectedUser(null);
        fetchUsers();
        fetchPendingCount();
      }
    } catch (err) {
      console.error("Delete user error:", err);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Users
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => { setTab(v); setPage(0); }}
        sx={{ mb: 2 }}
      >
        <Tab label="All" value="all" />
        <Tab
          label={
            <Badge badgeContent={pendingCount} color="warning" max={99}>
              Pending
            </Badge>
          }
          value="pending"
        />
        <Tab label="Approved" value="approved" />
        <Tab label="Disabled" value="disabled" />
      </Tabs>

      <Card sx={{ mb: 3, p: 2 }}>
        <TextField
          size="small"
          placeholder="Search by username or email…"
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
                    <TableCell>Username</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Links</TableCell>
                    <TableCell>Joined</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u._id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {u.username}
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {u.email}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={u.role}
                          size="small"
                          color={u.role === "admin" ? "primary" : "default"}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={STATUS_CHIP[u.status]?.label ?? u.status}
                          size="small"
                          color={STATUS_CHIP[u.status]?.color ?? "default"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{ cursor: "pointer", textDecoration: "underline", color: "primary.main" }}
                          onClick={() => router.push(`/admin/links?search=${u.username}`)}
                        >
                          {u.linkCount}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary", fontSize: 13 }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Actions">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              setSelectedUser(u);
                              setAnchorEl(e.currentTarget);
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                        No users found
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
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {selectedUser?.status === "pending" && (
          <MenuItem onClick={() => handleAction("approve")}>
            Approve Account
          </MenuItem>
        )}
        {selectedUser && !selectedUser.isVerified && (
          <MenuItem onClick={() => handleAction("verify")}>
            Verify Email
          </MenuItem>
        )}
        {selectedUser?.status === "approved" && (
          <MenuItem onClick={() => handleAction("disable")}>
            Disable Account
          </MenuItem>
        )}
        {selectedUser?.status === "disabled" && (
          <MenuItem onClick={() => handleAction("enable")}>
            Enable Account
          </MenuItem>
        )}
        {selectedUser?.role === "user" && (
          <MenuItem onClick={() => handleAction("promote")}>
            Promote to Admin
          </MenuItem>
        )}
        {selectedUser?.role === "admin" && (
          <MenuItem onClick={() => handleAction("demote")}>
            Demote to User
          </MenuItem>
        )}
        <MenuItem onClick={openEdit}>Edit Profile</MenuItem>
        <MenuItem onClick={openDelete} sx={{ color: "error.main" }}>
          Delete User
        </MenuItem>
      </Menu>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Profile — {selectedUser?.username}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {editError && (
            <Typography color="error" variant="body2">{editError}</Typography>
          )}
          <TextField
            label="Username"
            value={editUsername}
            onChange={(e) => setEditUsername(e.target.value)}
            fullWidth
          />
          <TextField
            label="Email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={editLoading || !editUsername || !editEmail}
          >
            {editLoading ? <CircularProgress size={20} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{selectedUser?.username}</strong> ({selectedUser?.email})?
            Their links will become ownerless. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleteLoading}
          >
            {deleteLoading ? <CircularProgress size={20} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
