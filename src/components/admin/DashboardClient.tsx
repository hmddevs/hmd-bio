"use client";

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
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useTheme } from "@mui/material/styles";
import { useRouter } from "next/navigation";

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
  baseUrl: string;
}

export default function DashboardClient({ data }: { data: DashboardData }) {
  const theme = useTheme();
  const router = useRouter();
  const { totalLinks, totalClicks, topLinks, recentLinks, recentActivity, baseUrl } = data;

  const clicks24h = recentActivity.reduce((sum, a) => sum + a.count, 0);

  const chartData = recentActivity.map((point) => ({
    hour: point._id.slice(11, 16),
    clicks: point.count,
  }));

  const stats = [
    { label: "Total Links", value: totalLinks, icon: <LinkIcon sx={{ fontSize: 32 }} /> },
    { label: "Total Clicks", value: totalClicks, icon: <TouchAppIcon sx={{ fontSize: 32 }} /> },
    { label: "Clicks (24h)", value: clicks24h, icon: <TrendingUpIcon sx={{ fontSize: 32 }} /> },
  ];

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Dashboard
      </Typography>

      {/* Stats Cards */}
      <Grid container spacing={2} mb={3}>
        {stats.map((s) => (
          <Grid size={{ xs: 12, md: 4 }} key={s.label}>
            <Card>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Box sx={{ color: "primary.main" }}>{s.icon}</Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {s.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {s.value.toLocaleString()}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} mb={3}>
        {/* Top Links */}
        <Grid size={{ xs: 12, lg: 6 }}>
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
        <Grid size={{ xs: 12, lg: 6 }}>
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
      </Grid>

      {/* 24h Activity Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              24-Hour Activity
            </Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: theme.palette.background.paper,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="clicks" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
