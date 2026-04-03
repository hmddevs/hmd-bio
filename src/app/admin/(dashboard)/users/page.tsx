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
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import MoreVertIcon from "@mui/icons-material/MoreVert";

interface UserRow {
  _id: string;
  username: string;
  email: string;
  role: string;
  isVerified: boolean;
  isDisabled: boolean;
  linkCount: number;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        ...(search && { search }),
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
  }, [page, rowsPerPage, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
      }
    } catch (err) {
      console.error("User action error:", err);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Users
      </Typography>

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
                        {u.isDisabled ? (
                          <Chip label="Disabled" size="small" color="error" />
                        ) : u.isVerified ? (
                          <Chip label="Verified" size="small" color="success" />
                        ) : (
                          <Chip label="Unverified" size="small" color="warning" />
                        )}
                      </TableCell>
                      <TableCell align="right">{u.linkCount}</TableCell>
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

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {selectedUser && !selectedUser.isVerified && (
          <MenuItem onClick={() => handleAction("verify")}>
            Verify Email
          </MenuItem>
        )}
        {selectedUser && !selectedUser.isDisabled && (
          <MenuItem onClick={() => handleAction("disable")}>
            Disable Account
          </MenuItem>
        )}
        {selectedUser && selectedUser.isDisabled && (
          <MenuItem onClick={() => handleAction("enable")}>
            Enable Account
          </MenuItem>
        )}
        {selectedUser && selectedUser.role === "user" && (
          <MenuItem onClick={() => handleAction("promote")}>
            Promote to Admin
          </MenuItem>
        )}
        {selectedUser && selectedUser.role === "admin" && (
          <MenuItem onClick={() => handleAction("demote")}>
            Demote to User
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
