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

interface ClickRecord {
  id: string;
  keyword: string;
  linkTitle: string;
  linkUrl: string;
  createdAt: string;
  ip: string;
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
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [country, setCountry] = useState("");
  const [browser, setBrowser] = useState("");
  const [os, setOs] = useState("");

  const fetchClicks = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page + 1),
      limit: String(rowsPerPage),
    });
    if (keyword) params.set("keyword", keyword);
    if (country) params.set("country", country);
    if (browser) params.set("browser", browser);
    if (os) params.set("os", os);

    try {
      const res = await fetch(`/api/v1/user/clicks?${params}`);
      const json = await res.json();
      if (json.success) {
        setClicks(json.data.clicks);
        setTotal(json.data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, keyword, country, browser, os]);

  useEffect(() => {
    fetchClicks();
  }, [fetchClicks]);

  useEffect(() => {
    setPage(0);
  }, [keyword, country, browser, os]);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Click Log
      </Typography>

      {/* Filters */}
      <Card sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="Keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> } }}
            sx={{ width: 150 }}
          />
          <TextField
            size="small"
            placeholder="Country code"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            sx={{ width: 130 }}
          />
          <TextField
            size="small"
            placeholder="Browser"
            value={browser}
            onChange={(e) => setBrowser(e.target.value)}
            sx={{ width: 130 }}
          />
          <TextField
            size="small"
            placeholder="OS"
            value={os}
            onChange={(e) => setOs(e.target.value)}
            sx={{ width: 130 }}
          />
        </Box>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
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
                    <TableCell sx={{ fontWeight: 600 }}>Visitor ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Country</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Browser</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>OS</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Referrer</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {clicks.map((click) => (
                    <TableRow key={click.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/links`)}>
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
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 12 }}>
                          {click.ip}
                        </Typography>
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
