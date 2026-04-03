"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  CircularProgress,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Chip,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import AvTimerIcon from "@mui/icons-material/AvTimer";
import PublicIcon from "@mui/icons-material/Public";
const LineChart = lazy(() => import("@mui/x-charts/LineChart").then(m => ({ default: m.LineChart })));
import { useTheme } from "@mui/material/styles";
import { getCountryName, getCountryFlag } from "@/lib/countries";

interface TopLink {
  keyword: string;
  url: string;
  title?: string;
  clicks: number;
}

interface Stats {
  totalLinks: number;
  totalClicks: number;
  avgClicks: number;
  clicks24h: number;
  weeklyTrend: { date: string; count: number }[];
  topLinks: TopLink[];
  topCountries: { code: string; count: number }[];
}

export default function DashboardPage() {
  const router = useRouter();
  const theme = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/user/stats");
        const json = await res.json();
        if (json.success) {
          setStats(json.data);
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const statCards = [
    { label: "Total Links", value: stats?.totalLinks ?? 0, icon: <LinkIcon sx={{ fontSize: 32 }} />, color: "primary.main" },
    { label: "Total Clicks", value: stats?.totalClicks ?? 0, icon: <TouchAppIcon sx={{ fontSize: 32 }} />, color: "success.main" },
    { label: "Clicks (24h)", value: stats?.clicks24h ?? 0, icon: <TrendingUpIcon sx={{ fontSize: 32 }} />, color: "warning.main" },
    { label: "Avg Clicks/Link", value: stats?.avgClicks ?? 0, icon: <AvTimerIcon sx={{ fontSize: 32 }} />, color: "info.main" },
  ];

  const topCountryMax = stats?.topCountries[0]?.count ?? 1;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>
          Dashboard
        </Typography>
        <Button variant="contained" onClick={() => router.push("/dashboard/links/new")}>
          Create Link
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2} mb={3}>
        {statCards.map((s) => (
          <Grid size={{ xs: 6, sm: 3 }} key={s.label}>
            <Card>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Box sx={{ color: s.color }}>{s.icon}</Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {s.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} mb={3}>
        {/* 7-Day Click Trend */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                7-Day Click Trend
              </Typography>
              {stats?.weeklyTrend && stats.weeklyTrend.length > 0 ? (
                <Suspense fallback={<LinearProgress />}>
                <LineChart
                  height={200}
                  series={[
                    {
                      data: stats.weeklyTrend.map((d) => d.count),
                      curve: "linear",
                      showMark: true,
                      color: theme.palette.primary.main,
                      area: true,
                    },
                  ]}
                  xAxis={[
                    {
                      data: stats.weeklyTrend.map((d) => d.date),
                      scaleType: "point",
                      tickLabelStyle: { fontSize: 11, fill: theme.palette.text.secondary },
                      valueFormatter: (v: string) => v.slice(5),
                    },
                  ]}
                  yAxis={[
                    {
                      tickLabelStyle: { fontSize: 11, fill: theme.palette.text.secondary },
                    },
                  ]}
                  margin={{ top: 10, bottom: 28, left: 36, right: 10 }}
                  hideLegend
                />
                </Suspense>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                  No click data yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Top Countries */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <PublicIcon sx={{ color: "primary.main" }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Top Countries
                </Typography>
              </Box>
              {stats?.topCountries && stats.topCountries.length > 0 ? (
                <List disablePadding>
                  {stats.topCountries.map((c) => (
                    <Box key={c.code} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {getCountryFlag(c.code)} {getCountryName(c.code)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {c.count.toLocaleString()}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(c.count / topCountryMax) * 100}
                        sx={{ height: 4, borderRadius: 2 }}
                      />
                    </Box>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">No data yet</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top Links */}
      <Typography variant="h6" fontWeight={600} mb={2}>
        Top Links
      </Typography>
      {stats?.topLinks.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary" align="center">
              No links yet. Create your first link!
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <List disablePadding>
            {stats?.topLinks.map((link) => (
              <ListItemButton
                key={link.keyword}
                onClick={() => router.push("/dashboard/links")}
                sx={{ borderRadius: 1, px: 2 }}
              >
                <ListItemText
                  primary={`hmd.bio/${link.keyword}`}
                  secondary={link.title || link.url}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500, color: "primary.main" }}
                  secondaryTypographyProps={{ fontSize: 12, noWrap: true }}
                />
                <Chip label={`${link.clicks.toLocaleString()} clicks`} size="small" />
              </ListItemButton>
            ))}
          </List>
        </Card>
      )}
    </Box>
  );
}
