"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Chip,
  Tooltip,
  CircularProgress,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { getCountryFlag, getCountryName } from "@/lib/countries";
import { captureError } from "@/lib/errors";

interface ClickRecord {
  _id: string;
  keyword: string;
  createdAt: string;
  countryCode: string;
  browser: string;
  os: string;
  referrer: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function UserClicksPage() {
  const router = useRouter();
  const [clicks, setClicks] = useState<ClickRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(false);

  // The click log endpoint is scoped to a single link (/api/v1/links/[keyword]/clicks) —
  // there is no cross-keyword click feed, so a keyword must be entered to see anything.
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const fetchClicks = useCallback(async () => {
    if (!keyword) {
      setClicks([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page + 1),
      limit: String(rowsPerPage),
    });

    try {
      const res = await fetch(`/api/v1/links/${keyword}/clicks?${params}`);
      const json = await res.json();
      if (json.success) {
        setClicks(json.data.clicks);
        setTotal(json.data.pagination.total);
      } else {
        setClicks([]);
        setTotal(0);
      }
    } catch (err) {
      captureError(err, { route: "dashboard/clicks", keyword });
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, keyword]);

  useEffect(() => {
    fetchClicks();
  }, [fetchClicks]);

  function handleSearch() {
    setKeyword(keywordInput.trim());
    setPage(0);
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Click Log
      </Typography>

      {/* Keyword picker */}
      <Card sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="Keyword"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> } }}
            sx={{ width: 220 }}
          />
        </Box>
      </Card>

      {/* Table */}
      <Card>
        {!keyword ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="text.secondary">Enter a keyword above to view its click log</Typography>
          </Box>
        ) : loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : clicks.length === 0 ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="text.secondary">No clicks found</Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Time</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Keyword</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Country</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Browser</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>OS</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Referrer</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {clicks.map((click) => (
                    <TableRow key={click._id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/links/${click.keyword}`)}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        <Tooltip title={new Date(click.createdAt).toLocaleString()}>
                          <span>{timeAgo(click.createdAt)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`/${click.keyword}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                          clickable
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {click.countryCode ? (
                          <Tooltip title={getCountryName(click.countryCode)}>
                            <span>{getCountryFlag(click.countryCode)} {click.countryCode}</span>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>{click.browser || "—"}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>{click.os || "—"}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        {click.referrer ? (
                          <Tooltip title={click.referrer}>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                              {(() => { try { return new URL(click.referrer).hostname; } catch { return click.referrer; } })()}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.secondary">Direct</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
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
              rowsPerPageOptions={[25, 50, 100]}
            />
          </>
        )}
      </Card>
    </Box>
  );
}
