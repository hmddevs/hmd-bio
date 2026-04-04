"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  IconButton,
  Tabs,
  Tab,
  TextField,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  CircularProgress,
  Divider,
  Alert,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import QrCodeIcon from "@mui/icons-material/QrCode2";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";
import PublicIcon from "@mui/icons-material/Public";
import DevicesIcon from "@mui/icons-material/Devices";
import LinkIcon from "@mui/icons-material/Link";
import TimelineIcon from "@mui/icons-material/Timeline";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import StarIcon from "@mui/icons-material/Star";
import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { PieChart as MuiPieChart } from "@mui/x-charts/PieChart";
import { getCountryFlag, getCountryName } from "@/lib/countries";

const CountryMapSection = lazy(() => import("@/app/admin/(dashboard)/links/[keyword]/CountryMap"));

interface LinkData {
  keyword: string;
  url: string;
  title: string;
  clicks: number;
  statusCode: number;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  createdAt: string;
}

interface Stats {
  clicksInPeriod: number;
  period: string;
  bestDay: { date: string; count: number } | null;
  directCount: number;
  referredCount: number;
  directPercent: number;
  uniqueReferrers: number;
  uniqueCountries: number;
  referrers: { referrer: string; count: number }[];
  countries: { code: string; count: number }[];
  timeline: { date: string; count: number }[];
  browsers: { name: string; count: number }[];
  operatingSystems: { name: string; count: number }[];
}

const PIE_COLORS = [
  "#90caf9", "#f48fb1", "#ce93d8", "#ffcc80", "#a5d6a7",
  "#80deea", "#ff8a65", "#bcaaa4", "#b0bec5", "#9fa8da",
];

type Period = "24h" | "7d" | "30d" | "all";

export default function UserLinkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const theme = useTheme();
  const keyword = params.keyword as string;

  const [link, setLink] = useState<LinkData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState<Period>("all");
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [clicksData, setClicksData] = useState<{ id: string; createdAt: string; countryCode: string; browser: string; os: string; referrer: string }[]>([]);
  const [clicksTotal, setClicksTotal] = useState(0);
  const [clicksPage, setClicksPage] = useState(0);
  const [clicksLoading, setClicksLoading] = useState(false);
  const [form, setForm] = useState({
    url: "",
    title: "",
    statusCode: 301,
    newPassword: "",
    removePassword: false,
    expiresAt: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
  });
  const [qrSvg, setQrSvg] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://hmd.bio";
  const shortUrl = `${baseUrl}/${keyword}`;

  const loadStats = useCallback(async (p: Period) => {
    const res = await fetch(`/api/v1/user/stats/${keyword}?period=${p}`);
    const data = await res.json();
    if (data.success) setStats(data.data);
  }, [keyword]);

  useEffect(() => {
    async function loadLink() {
      const res = await fetch(`/api/v1/user/links/${keyword}`);
      const data = await res.json();
      if (data.success) {
        setLink(data.data);
        setForm({
          url: data.data.url,
          title: data.data.title || "",
          statusCode: data.data.statusCode,
          newPassword: "",
          removePassword: false,
          expiresAt: data.data.expiresAt ? data.data.expiresAt.slice(0, 16) : "",
          ogTitle: data.data.ogTitle || "",
          ogDescription: data.data.ogDescription || "",
          ogImage: data.data.ogImage || "",
        });
      } else {
        router.push("/dashboard/links");
      }
    }
    loadLink();
  }, [keyword, router]);

  useEffect(() => {
    loadStats(period);
  }, [keyword, loadStats, period]);

  const loadClicks = useCallback(async (pg: number) => {
    setClicksLoading(true);
    try {
      const res = await fetch(`/api/v1/user/clicks?keyword=${keyword}&page=${pg + 1}&limit=25`);
      const data = await res.json();
      if (data.success) {
        setClicksData(data.data.clicks);
        setClicksTotal(data.data.total);
      }
    } catch { /* ignore */ } finally {
      setClicksLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    if (tab === 4) loadClicks(clicksPage);
  }, [tab, clicksPage, loadClicks]);

  function handlePeriodChange(_: React.MouseEvent<HTMLElement>, val: Period | null) {
    if (val) setPeriod(val);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = {
      url: form.url,
      title: form.title,
      statusCode: form.statusCode,
      ogTitle: form.ogTitle || undefined,
      ogDescription: form.ogDescription || undefined,
      ogImage: form.ogImage || undefined,
    };
    if (form.newPassword) body.password = form.newPassword;
    if (form.removePassword) body.removePassword = true;
    if (form.expiresAt) body.expiresAt = new Date(form.expiresAt).toISOString();

    const res = await fetch(`/api/v1/user/links/${keyword}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      setLink(data.data);
      setEditOpen(false);
      // If keyword changed, redirect to the new page
      if (data.data.keyword !== keyword) {
        router.replace(`/dashboard/links/${data.data.keyword}`);
      }
    } else {
      setError(data.error || "Failed to save");
    }
    setSaving(false);
  }

  async function handleGenerateQr() {
    const res = await fetch(`/api/v1/user/links/${keyword}/qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) setQrSvg(data.data.svg);
  }

  function handleCopy() {
    navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function faviconUrl(referrer: string): string {
    if (referrer === "Direct" || !referrer) return "";
    try {
      const domain = new URL(referrer.startsWith("http") ? referrer : `https://${referrer}`).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return "";
    }
  }

  const countryClickMap: Record<string, number> = {};
  if (stats) {
    for (const c of stats.countries) {
      if (c.code !== "Unknown") countryClickMap[c.code] = c.count;
    }
  }
  const maxClicks = Math.max(...Object.values(countryClickMap), 1);

  if (!link) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1000 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => router.push("/dashboard/links")} sx={{ mb: 1 }}>
            Back to links
          </Button>
          <Typography variant="h5" fontWeight={700}>{shortUrl}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 500 }}>
            {link.url}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
            {link.statusCode === 302 && <Chip label="302 Temporary" size="small" color="warning" />}
            {link.isPasswordProtected && <Chip label="Password Protected" size="small" color="info" />}
            {link.expiresAt && <Chip label={`Expires ${new Date(link.expiresAt).toLocaleDateString()}`} size="small" />}
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title={copied ? "Copied!" : "Copy URL"}>
            <IconButton onClick={handleCopy} color={copied ? "success" : "default"}>
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
          <Button variant="outlined" size="small" startIcon={<QrCodeIcon />} onClick={handleGenerateQr}>QR</Button>
          <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>Edit</Button>
        </Box>
      </Box>

      {/* QR Code */}
      {qrSvg && (
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ textAlign: "center" }}>
            <Typography variant="subtitle2" gutterBottom>QR Code</Typography>
            <Box dangerouslySetInnerHTML={{ __html: qrSvg }} sx={{ "& svg": { maxWidth: 200, mx: "auto" } }} />
            <Button size="small" onClick={() => setQrSvg("")} sx={{ mt: 1 }}>Close</Button>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      {stats && (
        <Grid container spacing={2} mb={2}>
          <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Total Clicks</Typography>
                <Typography variant="h5" fontWeight={700}>{link.clicks.toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Unique Referrers</Typography>
                <Typography variant="h5" fontWeight={700}>{stats.uniqueReferrers}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Countries</Typography>
                <Typography variant="h5" fontWeight={700}>{stats.uniqueCountries}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Best Day</Typography>
                <Typography variant="h6" fontWeight={700} noWrap>
                  {stats.bestDay ? `${stats.bestDay.date.slice(5)} (${stats.bestDay.count})` : "—"}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Direct %</Typography>
                <Typography variant="h5" fontWeight={700}>{stats.directPercent}%</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tabs */}
      {stats && (
        <Card>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", px: 2 }} variant="scrollable" scrollButtons="auto">
            <Tab icon={<TimelineIcon />} iconPosition="start" label="Timeline" />
            <Tab icon={<LinkIcon />} iconPosition="start" label="Referrers" />
            <Tab icon={<PublicIcon />} iconPosition="start" label="Countries" />
            <Tab icon={<DevicesIcon />} iconPosition="start" label="Browser / OS" />
            <Tab icon={<TouchAppIcon />} iconPosition="start" label="Clicks" />
            <Tab icon={<ShareIcon />} iconPosition="start" label="Share" />
          </Tabs>
          <CardContent>
            {/* Timeline Tab */}
            {tab === 0 && (
              <Box>
                <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
                  <ToggleButtonGroup value={period} exclusive onChange={handlePeriodChange} size="small">
                    <ToggleButton value="24h">24h</ToggleButton>
                    <ToggleButton value="7d">7d</ToggleButton>
                    <ToggleButton value="30d">30d</ToggleButton>
                    <ToggleButton value="all">All</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                {stats.bestDay && (
                  <Alert icon={<StarIcon />} severity="info" sx={{ mb: 2 }}>
                    Best day: <strong>{stats.bestDay.date}</strong> with <strong>{stats.bestDay.count}</strong> clicks
                  </Alert>
                )}
                {stats.timeline.length === 0 ? (
                  <Typography color="text.secondary">No timeline data yet</Typography>
                ) : (
                  <LineChart
                    height={300}
                    series={[{
                      data: stats.timeline.map((d) => d.count),
                      curve: "linear",
                      showMark: false,
                      label: "Clicks",
                      color: theme.palette.primary.main,
                    }]}
                    xAxis={[{
                      data: stats.timeline.map((d) => d.date),
                      scaleType: "point",
                      tickLabelStyle: { fontSize: 11, fill: theme.palette.text.secondary },
                      valueFormatter: (v: string) => v.slice(5),
                    }]}
                    yAxis={[{ tickLabelStyle: { fontSize: 11, fill: theme.palette.text.secondary } }]}
                    grid={{ horizontal: true }}
                    hideLegend
                  />
                )}
              </Box>
            )}

            {/* Referrers Tab */}
            {tab === 1 && (
              <Box>
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                  <strong>{stats.directCount}</strong> direct · <strong>{stats.referredCount}</strong> referred ({stats.directPercent}% direct)
                </Alert>
                {stats.referrers.length === 0 ? (
                  <Typography color="text.secondary">No referrer data</Typography>
                ) : (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <MuiPieChart
                        height={280}
                        series={[{
                          data: stats.referrers.slice(0, 10).map((r, i) => ({
                            id: i, value: r.count, label: r.referrer,
                            color: PIE_COLORS[i % PIE_COLORS.length],
                          })),
                          innerRadius: 40, outerRadius: 100, paddingAngle: 1, cornerRadius: 2,
                        }]}
                        slotProps={{ legend: { direction: "vertical" } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <List dense disablePadding>
                        {stats.referrers.map((r) => {
                          const fav = faviconUrl(r.referrer);
                          return (
                            <ListItem key={r.referrer} sx={{ px: 0 }}>
                              <ListItemAvatar sx={{ minWidth: 36 }}>
                                {fav ? (
                                  <Avatar src={fav} sx={{ width: 20, height: 20 }} variant="square" />
                                ) : (
                                  <Avatar sx={{ width: 20, height: 20, fontSize: 12 }} variant="square">
                                    <LinkIcon sx={{ fontSize: 14 }} />
                                  </Avatar>
                                )}
                              </ListItemAvatar>
                              <ListItemText primary={r.referrer} primaryTypographyProps={{ fontSize: 13, noWrap: true }} />
                              <Chip label={r.count} size="small" />
                            </ListItem>
                          );
                        })}
                      </List>
                    </Grid>
                  </Grid>
                )}
              </Box>
            )}

            {/* Countries Tab */}
            {tab === 2 && (
              <Box>
                {stats.countries.length === 0 ? (
                  <Typography color="text.secondary">No country data</Typography>
                ) : (
                  <Suspense fallback={<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>}>
                    <CountryMapSection countries={stats.countries} countryClickMap={countryClickMap} maxClicks={maxClicks} />
                  </Suspense>
                )}
              </Box>
            )}

            {/* Browser / OS Tab */}
            {tab === 3 && (
              <Box>
                {stats.browsers.length === 0 && stats.operatingSystems.length === 0 ? (
                  <Typography color="text.secondary">No device data yet</Typography>
                ) : (
                  <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>Browsers</Typography>
                      {stats.browsers.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No data</Typography>
                      ) : (
                        <MuiPieChart
                          height={280}
                          series={[{
                            data: stats.browsers.map((b, i) => ({
                              id: i, value: b.count, label: b.name,
                              color: PIE_COLORS[i % PIE_COLORS.length],
                            })),
                            innerRadius: 30, outerRadius: 90, paddingAngle: 1, cornerRadius: 2,
                          }]}
                          slotProps={{ legend: { direction: "horizontal" } }}
                        />
                      )}
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>Operating Systems</Typography>
                      {stats.operatingSystems.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No data</Typography>
                      ) : (
                        <MuiPieChart
                          height={280}
                          series={[{
                            data: stats.operatingSystems.map((os, i) => ({
                              id: i, value: os.count, label: os.name,
                              color: PIE_COLORS[(i + 5) % PIE_COLORS.length],
                            })),
                            innerRadius: 30, outerRadius: 90, paddingAngle: 1, cornerRadius: 2,
                          }]}
                          slotProps={{ legend: { direction: "horizontal" } }}
                        />
                      )}
                    </Grid>
                  </Grid>
                )}
              </Box>
            )}

            {/* Clicks Tab */}
            {tab === 4 && (
              <Box>
                {clicksLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
                ) : clicksData.length === 0 ? (
                  <Typography color="text.secondary">No click data yet</Typography>
                ) : (
                  <>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Time</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Country</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Browser</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>OS</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Referrer</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {clicksData.map((click) => (
                            <TableRow key={click.id} hover>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                <Tooltip title={new Date(click.createdAt).toLocaleString()}>
                                  <Typography variant="body2">
                                    {(() => {
                                      const diff = Date.now() - new Date(click.createdAt).getTime();
                                      const mins = Math.floor(diff / 60000);
                                      if (mins < 1) return "just now";
                                      if (mins < 60) return `${mins}m ago`;
                                      const hrs = Math.floor(mins / 60);
                                      if (hrs < 24) return `${hrs}h ago`;
                                      return `${Math.floor(hrs / 24)}d ago`;
                                    })()}
                                  </Typography>
                                </Tooltip>
                              </TableCell>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                {click.countryCode ? (
                                  <Tooltip title={getCountryName(click.countryCode)}>
                                    <span>{getCountryFlag(click.countryCode)} {click.countryCode}</span>
                                  </Tooltip>
                                ) : "—"}
                              </TableCell>
                              <TableCell><Typography variant="body2" noWrap>{click.browser || "—"}</Typography></TableCell>
                              <TableCell><Typography variant="body2" noWrap>{click.os || "—"}</Typography></TableCell>
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
                      count={clicksTotal}
                      page={clicksPage}
                      onPageChange={(_, p) => setClicksPage(p)}
                      rowsPerPage={25}
                      rowsPerPageOptions={[25]}
                    />
                  </>
                )}
              </Box>
            )}

            {/* Share Tab */}
            {tab === 5 && (
              <Box>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Share this link: <strong>{shortUrl}</strong>
                </Alert>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={() => window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shortUrl)}`, "_blank")}>Twitter / X</Button>
                  <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shortUrl)}`, "_blank")}>Facebook</Button>
                  <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={() => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shortUrl)}`, "_blank")}>LinkedIn</Button>
                  <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={() => window.open(`mailto:?body=${encodeURIComponent(shortUrl)}`, "_blank")}>Email</Button>
                  <Button variant="contained" size="small" startIcon={<ContentCopyIcon />} onClick={handleCopy}>{copied ? "Copied!" : "Copy Link"}</Button>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Link</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Destination URL" type="url" fullWidth value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <TextField label="Title" fullWidth value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField label="Redirect Type" select fullWidth value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: Number(e.target.value) })}>
                  <MenuItem value={301}>301 — Permanent</MenuItem>
                  <MenuItem value={302}>302 — Temporary</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField label="Expires At" type="datetime-local" fullWidth value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
            </Grid>

            <Divider />
            <Typography variant="subtitle2">Password Protection</Typography>
            {link.isPasswordProtected && (
              <FormControlLabel
                control={<Checkbox checked={form.removePassword} onChange={(e) => setForm({ ...form, removePassword: e.target.checked })} />}
                label="Remove password"
              />
            )}
            <TextField
              label={link.isPasswordProtected ? "Change password" : "Set password"}
              type="password"
              fullWidth
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />

            <Divider />
            <Typography variant="subtitle2">Open Graph Metadata</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField label="OG Title" fullWidth value={form.ogTitle} onChange={(e) => setForm({ ...form, ogTitle: e.target.value })} />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField label="OG Image URL" type="url" fullWidth value={form.ogImage} onChange={(e) => setForm({ ...form, ogImage: e.target.value })} />
              </Grid>
            </Grid>
            <TextField label="OG Description" fullWidth multiline rows={2} value={form.ogDescription} onChange={(e) => setForm({ ...form, ogDescription: e.target.value })} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
