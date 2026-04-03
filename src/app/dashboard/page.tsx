"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  CircularProgress,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

interface Stats {
  totalLinks: number;
  totalClicks: number;
  recentLinks: { keyword: string; url: string; clicks: number; createdAt: string }[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/user/links?limit=5&sort=createdAt&order=desc");
        const json = await res.json();
        if (json.success) {
          const links = json.data.links;
          setStats({
            totalLinks: json.data.pagination.total,
            totalClicks: links.reduce((s: number, l: { clicks: number }) => s + l.clicks, 0),
            recentLinks: links,
          });
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

      <Grid container spacing={3} mb={4}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <LinkIcon sx={{ fontSize: 40, color: "primary.main" }} />
              <Box>
                <Typography variant="h4" fontWeight={700}>
                  {stats?.totalLinks ?? 0}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Total Links
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <TouchAppIcon sx={{ fontSize: 40, color: "success.main" }} />
              <Box>
                <Typography variant="h4" fontWeight={700}>
                  {stats?.totalClicks?.toLocaleString() ?? 0}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Total Clicks
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <TrendingUpIcon sx={{ fontSize: 40, color: "warning.main" }} />
              <Box>
                <Typography variant="h4" fontWeight={700}>
                  {stats && stats.totalLinks > 0
                    ? (stats.totalClicks / stats.totalLinks).toFixed(1)
                    : "0"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Avg Clicks/Link
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Recent links */}
      <Typography variant="h6" fontWeight={600} mb={2}>
        Recent Links
      </Typography>
      {stats?.recentLinks.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary" align="center">
              No links yet. Create your first link!
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {stats?.recentLinks.map((link) => (
            <Card key={link.keyword} sx={{ cursor: "pointer" }} onClick={() => router.push("/dashboard/links")}>
              <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} color="primary.main">
                    hmd.bio/{link.keyword}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="p">
                    {link.url}
                  </Typography>
                </Box>
                <Typography variant="body2" fontFamily="monospace" fontWeight={600} sx={{ ml: 2 }}>
                  {link.clicks} clicks
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
