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
  TableSortLabel,
  TablePagination,
  IconButton,
  Chip,
  Button,
  InputAdornment,
  Collapse,
  Grid,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import DeleteIcon from "@mui/icons-material/Delete";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import LockIcon from "@mui/icons-material/Lock";
import AddIcon from "@mui/icons-material/Add";

const SOURCE_COLORS: Record<string, "default" | "primary" | "secondary" | "info" | "warning"> = {
  form: "default",
  api: "info",
  bulk: "warning",
  dashboard: "primary",
};

interface LinkItem {
  _id: string;
  keyword: string;
  url: string;
  title: string;
  clicks: number;
  statusCode: number;
  isPasswordProtected: boolean;
  createdAt: string;
  owner?: { _id: string; username: string; email: string } | null;
  createdVia?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UserOption {
  _id: string;
  username: string;
}

export default function LinksPage() {
  const router = useRouter();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, limit: 15, total: 0, totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minClicks, setMinClicks] = useState("");
  const [maxClicks, setMaxClicks] = useState("");
  const [deleteKeyword, setDeleteKeyword] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [users, setUsers] = useState<UserOption[]>([]);

  // Create Link dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createUrl, setCreateUrl] = useState("");
  const [createKeyword, setCreateKeyword] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const baseUrl = typeof window !== "undefined"
    ? window.location.origin
    : "https://hmd.bio";

  const fetchLinks = useCallback(async (page = 1, rowsPerPage?: number) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(rowsPerPage ?? pagination.limit),
      sort,
      order,
      ...(search ? { search } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(minClicks ? { minClicks } : {}),
      ...(maxClicks ? { maxClicks } : {}),
      ...(ownerFilter !== "all" ? { ownerType: ownerFilter } : {}),
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
  }, [search, sort, order, dateFrom, dateTo, minClicks, maxClicks, ownerFilter, pagination.limit]);

  useEffect(() => {
    fetchLinks(1);
  }, [fetchLinks]);

  useEffect(() => {
    fetch("/api/v1/admin/users?limit=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setUsers(d.data.users);
      })
      .catch(() => {});
  }, []);

  async function handleDelete() {
    if (!deleteKeyword) return;
    const res = await fetch(`/api/v1/links/${deleteKeyword}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      fetchLinks(pagination.page);
    }
    setDeleteKeyword(null);
  }

  async function handleCreate() {
    if (!createUrl.trim()) return;
    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await fetch("/api/v1/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: createUrl.trim(),
          ...(createKeyword.trim() && { keyword: createKeyword.trim() }),
          ...(createTitle.trim() && { title: createTitle.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Failed to create link");
      } else {
        setCreateOpen(false);
        setCreateUrl("");
        setCreateKeyword("");
        setCreateTitle("");
        fetchLinks(1);
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreateLoading(false);
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

  function handleChangePage(_: unknown, newPage: number) {
    fetchLinks(newPage + 1);
  }

  function handleChangeRowsPerPage(e: React.ChangeEvent<HTMLInputElement>) {
    const newLimit = parseInt(e.target.value, 10);
    fetchLinks(1, newLimit);
  }

  const from = (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>
          Links
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            Create Link
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownloadIcon />}
            href="/api/v1/links/export"
          >
            Export CSV
          </Button>
        </Box>
      </Box>

      {/* Search + Filters */}
      <Card sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField
            size="small"
            placeholder="Search keywords, URLs, titles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, maxWidth: 400 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button
            variant={showFilters ? "contained" : "outlined"}
            size="small"
            startIcon={<FilterListIcon />}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
          </Button>
        </Box>

        <Collapse in={showFilters}>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                label="Date from"
                type="date"
                fullWidth
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                label="Date to"
                type="date"
                fullWidth
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                label="Min clicks"
                type="number"
                fullWidth
                value={minClicks}
                onChange={(e) => setMinClicks(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                size="small"
                label="Max clicks"
                type="number"
                fullWidth
                value={maxClicks}
                onChange={(e) => setMaxClicks(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Owner</InputLabel>
                <Select
                  value={ownerFilter}
                  label="Owner"
                  onChange={(e) => setOwnerFilter(e.target.value)}
                >
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="public">Public (no owner)</MenuItem>
                  {users.map((u) => (
                    <MenuItem key={u._id} value={u._id}>
                      {u.username}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Collapse>
      </Card>

      {/* Summary */}
      {!loading && (
        <Typography variant="body2" color="text.secondary" mb={1}>
          Showing {from}–{to} of {pagination.total.toLocaleString()} links
          {" · "}
          {links.reduce((s, l) => s + l.clicks, 0).toLocaleString()} clicks on this page
        </Typography>
      )}

      {/* Table */}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sort === "keyword"}
                    direction={sort === "keyword" ? order : "asc"}
                    onClick={() => handleSort("keyword")}
                  >
                    Short URL
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sort === "url"}
                    direction={sort === "url" ? order : "asc"}
                    onClick={() => handleSort("url")}
                  >
                    Destination
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sort === "clicks"}
                    direction={sort === "clicks" ? order : "asc"}
                    onClick={() => handleSort("clicks")}
                  >
                    Clicks
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sort === "createdAt"}
                    direction={sort === "createdAt" ? order : "asc"}
                    onClick={() => handleSort("createdAt")}
                  >
                    Created
                  </TableSortLabel>
                </TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Source</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    No links found
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link) => (
                  <TableRow
                    key={link._id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => router.push(`/admin/links/${link.keyword}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={500} color="primary.main">
                        {baseUrl}/{link.keyword}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 0.5, mt: 0.25 }}>
                        {link.statusCode === 302 && (
                          <Chip label="302" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                        )}
                        {link.isPasswordProtected && (
                          <Chip icon={<LockIcon sx={{ fontSize: 12 }} />} label="Protected" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" noWrap>
                        {link.title || link.url}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="p">
                        {link.url}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontFamily="monospace">
                        {link.clicks.toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(link.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {link.owner?.username || "Public"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {link.createdVia && (
                        <Chip
                          label={link.createdVia}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: 11,
                            bgcolor: SOURCE_COLORS[link.createdVia] || SOURCE_COLORS.form,
                            color: "#fff",
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteKeyword(link.keyword);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={pagination.total}
          page={pagination.page - 1}
          onPageChange={handleChangePage}
          rowsPerPage={pagination.limit}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[15, 25, 50, 100]}
        />
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteKeyword} onClose={() => setDeleteKeyword(null)}>
        <DialogTitle>Delete Link</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>hmd.bio/{deleteKeyword}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteKeyword(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Link Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Link</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {createError && (
            <Typography color="error" variant="body2">{createError}</Typography>
          )}
          <TextField
            label="Destination URL"
            placeholder="https://example.com"
            value={createUrl}
            onChange={(e) => setCreateUrl(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Custom keyword (optional)"
            placeholder="my-link"
            value={createKeyword}
            onChange={(e) => setCreateKeyword(e.target.value)}
            fullWidth
          />
          <TextField
            label="Title (optional)"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createLoading || !createUrl}
          >
            {createLoading ? <CircularProgress size={20} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
