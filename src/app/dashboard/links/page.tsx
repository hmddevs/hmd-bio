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
  Button,
  InputAdornment,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { captureError } from "@/lib/errors";

interface LinkItem {
  _id: string;
  keyword: string;
  url: string;
  title?: string;
  clicks: number;
  createdAt: string;
}

type SortField = "keyword" | "url" | "clicks" | "createdAt";

export default function MyLinksPage() {
  const router = useRouter();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortField>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });
  const [deleteKeyword, setDeleteKeyword] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://hmd.bio";

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
        sort,
        order,
        ...(search && { search }),
      });
      const res = await fetch(`/api/v1/links?${params}`);
      const json = await res.json();
      if (json.success) {
        setLinks(json.data.links);
        setPagination((p) => ({ ...p, ...json.data.pagination }));
      }
    } catch (err) {
      captureError(err, { route: "dashboard/links", action: "fetchLinks" });
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sort, order, search]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(field);
      setOrder("desc");
    }
  };

  const handleDelete = async () => {
    if (!deleteKeyword) return;
    setDeleteError("");
    try {
      const res = await fetch(`/api/v1/links/${deleteKeyword}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setDeleteError(json?.error || "Failed to delete link");
        return;
      }
      setDeleteKeyword(null);
      fetchLinks();
    } catch {
      setDeleteError("Network error. Please try again.");
    }
  };

  const copyToClipboard = (keyword: string) => {
    navigator.clipboard.writeText(`${baseUrl}/${keyword}`);
  };

  const from = (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>
          My Links
        </Typography>
        <Button variant="contained" onClick={() => router.push("/dashboard/links/new")}>
          Create Link
        </Button>
      </Box>

      <Card sx={{ mb: 3, p: 2 }}>
        <TextField
          size="small"
          placeholder="Search links…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPagination((p) => ({ ...p, page: 1 }));
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

      {!loading && (
        <Typography variant="body2" color="text.secondary" mb={1}>
          Showing {from}–{to} of {pagination.total.toLocaleString()} links
        </Typography>
      )}

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel active={sort === "keyword"} direction={sort === "keyword" ? order : "asc"} onClick={() => handleSort("keyword")}>
                    Short URL
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={sort === "url"} direction={sort === "url" ? order : "asc"} onClick={() => handleSort("url")}>
                    Destination
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel active={sort === "clicks"} direction={sort === "clicks" ? order : "asc"} onClick={() => handleSort("clicks")}>
                    Clicks
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel active={sort === "createdAt"} direction={sort === "createdAt" ? order : "asc"} onClick={() => handleSort("createdAt")}>
                    Created
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    No links found
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link) => (
                  <TableRow
                    key={link._id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => router.push(`/dashboard/links/${link.keyword}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={500} color="primary.main">
                        {baseUrl}/{link.keyword}
                      </Typography>
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
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="Copy short URL">
                        <IconButton size="small" onClick={() => copyToClipboard(link.keyword)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setDeleteError("");
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
          onPageChange={(_, p) => setPagination((prev) => ({ ...prev, page: p + 1 }))}
          rowsPerPage={pagination.limit}
          onRowsPerPageChange={(e) => setPagination((prev) => ({ ...prev, limit: parseInt(e.target.value, 10), page: 1 }))}
          rowsPerPageOptions={[15, 25, 50]}
        />
      </Card>

      <Dialog
        open={!!deleteKeyword}
        onClose={() => {
          setDeleteKeyword(null);
          setDeleteError("");
        }}
      >
        <DialogTitle>Delete Link</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{baseUrl}/{deleteKeyword}</strong>? This cannot be undone.
          </Typography>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteKeyword(null);
              setDeleteError("");
            }}
          >
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
