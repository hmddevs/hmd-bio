"use client";

import { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Chip,
  LinearProgress,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import PublicIcon from "@mui/icons-material/Public";
import SpeedIcon from "@mui/icons-material/Speed";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AvTimerIcon from "@mui/icons-material/AvTimer";
import { LineChart } from "@mui/x-charts/LineChart";
import { BarChart as MuiBarChart } from "@mui/x-charts/BarChart";
import { useTheme } from "@mui/material/styles";
import { useRouter } from "next/navigation";
import { getCountryName, getCountryFlag } from "@/lib/countries";

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

interface TopLink {
  keyword: string;
  url: string;
  title?: string;
  clicks: number;
}

interface RecentLink {
  keyword: string;
  url: string;
  title?: string;
  createdAt: string;
}

interface RecentClick {
  keyword: string;
  createdAt: string;
  ip: string;
  ipReal: string;
  countryCode: string;
  browser: string;
  os: string;
  referrer: string;
}

interface ActivityPoint {
  _id: string;
  count: number;
}

interface DashboardData {
  totalLinks: number;
  totalClicks: number;
  topLinks: TopLink[];
  recentLinks: RecentLink[];
  recentActivity: ActivityPoint[];
  weeklyTrend: { date: string; count: number }[];
  monthlyTrend: { date: string; count: number }[];
  quarterlyTrend: { date: string; count: number }[];
  topCountries: { code: string; count: number }[];
  linksCreatedLast7d: number;
  activeLinks: number;
  expiredLinks: number;
  avgClicks: number;
  baseUrl: string;
  recentClicks: RecentClick[];
}

type TrendRange = "7d" | "30d" | "90d";

export default function DashboardClient({ data }: { data: DashboardData }) {
  const theme = useTheme();
  const router = useRouter();
  const [trendRange, setTrendRange] = useState<TrendRange>("7d");
  const {
    totalLinks, totalClicks, topLinks, recentLinks, recentActivity, baseUrl,
    weeklyTrend, monthlyTrend, quarterlyTrend, topCountries, linksCreatedLast7d,
    activeLinks, expiredLinks, avgClicks, recentClicks,
  } = data;

  const clicks24h = recentActivity.reduce((sum, a) => sum + a.count, 0);

  const chartData = recentActivity.map((point) => ({
    hour: point._id.slice(11, 16),
    clicks: point.count,
  }));

  const topCountryMax = topCountries[0]?.count ?? 1;

  const stats = [
    { label: "Total Links", value: totalLinks, icon: <LinkIcon sx={{ fontSize: 32 }} /> },
    { label: "Total Clicks", value: totalClicks, icon: <TouchAppIcon sx={{ fontSize: 32 }} /> },
    { label: "Clicks (24h)", value: clicks24h, icon: <TrendingUpIcon sx={{ fontSize: 32 }} /> },
    { label: "Avg Clicks / Link", value: avgClicks, icon: <AvTimerIcon sx={{ fontSize: 32 }} /> },
  ];

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Dashboard
      </Typography>

      {/* Stats Cards */}
      <Grid container spacing={2} mb={3}>
        {stats.map((s) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={s.label}>
            <Card>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Box sx={{ color: "primary.main" }}>{s.icon}</Box>
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

      {/* Sparkline + Velocity + Active/Expired row */}
      <Grid container spacing={2} mb={3}>
        {/* Click Trend with range toggle */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Click Trend
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  value={trendRange}
                  exclusive
                  onChange={(_, v) => v && setTrendRange(v)}
                >
                  <ToggleButton value="7d" sx={{ px: 1, py: 0.25, fontSize: 11 }}>7d</ToggleButton>
                  <ToggleButton value="30d" sx={{ px: 1, py: 0.25, fontSize: 11 }}>30d</ToggleButton>
                  <ToggleButton value="90d" sx={{ px: 1, py: 0.25, fontSize: 11 }}>90d</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {(() => {
                const trendData = trendRange === "7d" ? weeklyTrend : trendRange === "30d" ? monthlyTrend : quarterlyTrend;
                if (trendData.length === 0) {
                  return <Typography variant="body2" color="text.secondary">No data yet</Typography>;
                }
                return (
                  <LineChart
                    height={120}
                    series={[
                      {
                        data: trendData.map((d) => d.count),
                        curve: "linear",
                        showMark: false,
                        color: theme.palette.primary.main,
                      },
                    ]}
                    xAxis={[
                      {
                        data: trendData.map((d) => d.date),
                        scaleType: "point",
                        tickLabelStyle: { fontSize: 10, fill: theme.palette.text.secondary },
                        valueFormatter: (v: string) => v.slice(5),
                      },
                    ]}
                    yAxis={[{ tickLabelStyle: { display: "none" } }]}
                    margin={{ top: 10, bottom: 24, left: 10, right: 10 }}
                    hideLegend
                  />
                );
              })()}
            </CardContent>
          </Card>
        </Grid>

        {/* Link Velocity */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <SpeedIcon sx={{ color: "primary.main" }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Link Velocity
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} color="primary.main">
                {linksCreatedLast7d}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                links created in the last 7 days
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Active / Expired */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <CheckCircleIcon sx={{ color: "success.main" }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Link Status
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 3, mb: 1 }}>
                <Box>
                  <Typography variant="h4" fontWeight={700} color="success.main">
                    {activeLinks}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Active</Typography>
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={700} color="text.secondary">
                    {expiredLinks}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Expired</Typography>
                </Box>
              </Box>
              {totalLinks > 0 && (
                <LinearProgress
                  variant="determinate"
                  value={(activeLinks / totalLinks) * 100}
                  sx={{ height: 6, borderRadius: 3, mt: 1 }}
                />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2} mb={3}>
        {/* Top Links */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                Top Links
              </Typography>
              <List disablePadding>
                {topLinks.map((link) => (
                  <ListItemButton
                    key={link.keyword}
                    onClick={() => router.push(`/admin/links/${link.keyword}`)}
                    sx={{ borderRadius: 1, px: 1 }}
                  >
                    <ListItemText
                      primary={`${baseUrl}/${link.keyword}`}
                      secondary={link.title || link.url}
                      primaryTypographyProps={{ fontSize: 14, fontWeight: 500, color: "primary.main" }}
                      secondaryTypographyProps={{ fontSize: 12, noWrap: true }}
                    />
                    <Chip label={link.clicks.toLocaleString()} size="small" />
                  </ListItemButton>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Links */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                Recent Links
              </Typography>
              <List disablePadding>
                {recentLinks.map((link) => (
                  <ListItemButton
                    key={link.keyword}
                    onClick={() => router.push(`/admin/links/${link.keyword}`)}
                    sx={{ borderRadius: 1, px: 1 }}
                  >
                    <ListItemText
                      primary={`${baseUrl}/${link.keyword}`}
                      secondary={link.title || link.url}
                      primaryTypographyProps={{ fontSize: 14, fontWeight: 500, color: "primary.main" }}
                      secondaryTypographyProps={{ fontSize: 12, noWrap: true }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", ml: 1 }}>
                      {new Date(link.createdAt).toLocaleDateString()}
                    </Typography>
                  </ListItemButton>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Recently Clicked */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                Recently Clicked
              </Typography>
              {recentClicks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No clicks yet</Typography>
              ) : (
                <List disablePadding>
                  {recentClicks.map((click, i) => (
                    <ListItemButton
                      key={i}
                      onClick={() => router.push(`/admin/links/${click.keyword}`)}
                      sx={{ borderRadius: 1, px: 1 }}
                    >
                      <ListItemText
                        primary={`/${click.keyword}`}
                        secondary={
                          [
                            click.countryCode ? getCountryFlag(click.countryCode) : "",
                            click.browser || "",
                            click.referrer ? (() => { try { return new URL(click.referrer).hostname; } catch { return click.referrer; } })() : "Direct",
                          ].filter(Boolean).join(" · ")
                        }
                        primaryTypographyProps={{ fontSize: 14, fontWeight: 500, color: "primary.main" }}
                        secondaryTypographyProps={{ fontSize: 12, noWrap: true }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", ml: 1 }}>
                        {timeAgo(click.createdAt)}
                      </Typography>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        {/* 24h Activity Chart */}
        {chartData.length > 0 && (
          <Grid size={{ xs: 12, md: 8 }}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} mb={2}>
                  24-Hour Activity
                </Typography>
                <MuiBarChart
                  height={220}
                  dataset={chartData}
                  series={[
                    {
                      dataKey: "clicks",
                      label: "Clicks",
                      color: theme.palette.primary.main,
                    },
                  ]}
                  xAxis={[
                    {
                      dataKey: "hour",
                      scaleType: "band",
                      tickLabelStyle: {
                        fontSize: 11,
                        fill: theme.palette.text.secondary,
                      },
                    },
                  ]}
                  yAxis={[
                    {
                      tickLabelStyle: {
                        fontSize: 11,
                        fill: theme.palette.text.secondary,
                      },
                    },
                  ]}
                  grid={{ horizontal: true }}
                  borderRadius={3}
                  hideLegend
                />
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Top Countries */}
        <Grid size={{ xs: 12, md: chartData.length > 0 ? 4 : 12 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <PublicIcon sx={{ color: "primary.main" }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Top Countries
                </Typography>
              </Box>
              {topCountries.length > 0 ? (
                <List disablePadding>
                  {topCountries.map((c) => (
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
    </Box>
  );
}
