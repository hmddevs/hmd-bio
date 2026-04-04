"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  AppBar,
  Badge,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import LinkIcon from "@mui/icons-material/Link";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import PeopleIcon from "@mui/icons-material/People";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";

const DRAWER_WIDTH = 260;

const navItems = [
  { label: "Dashboard", href: "/admin", icon: <DashboardIcon /> },
  { label: "Links", href: "/admin/links", icon: <LinkIcon /> },
  { label: "Clicks", href: "/admin/clicks", icon: <TouchAppIcon /> },
  { label: "Users", href: "/admin/users", icon: <PeopleIcon /> },
  { label: "Settings", href: "/admin/settings", icon: <SettingsIcon /> },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/v1/admin/users?status=pending&limit=1")
      .then((r) => r.json())
      .then((j) => { if (j.success) setPendingCount(j.data.pagination.total); })
      .catch(() => {});
  }, []);

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ px: 3 }}>
        <Link href="/admin" style={{ textDecoration: "none" }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "text.primary" }}>
            HMD<span style={{ color: theme.palette.primary.main }}>.bio</span>
          </Typography>
        </Link>
      </Toolbar>
      <Divider />
      <List sx={{ flex: 1, px: 1.5, pt: 1 }}>
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <ListItemButton
              key={item.href}
              selected={isActive}
              onClick={() => {
                router.push(item.href);
                if (!isDesktop) setMobileOpen(false);
              }}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": { bgcolor: "primary.dark" },
                  "& .MuiListItemIcon-root": { color: "primary.contrastText" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={
                  item.label === "Users" && pendingCount > 0 ? (
                    <Badge badgeContent={pendingCount} color="warning" max={99} sx={{ "& .MuiBadge-badge": { right: -16, top: 2 } }}>
                      {item.label}
                    </Badge>
                  ) : (
                    item.label
                  )
                }
                primaryTypographyProps={{ fontWeight: 500, fontSize: 14 }}
              />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <List sx={{ px: 1.5, pb: 1 }}>
        <ListItemButton
          onClick={() => signOut({ callbackUrl: "/login" })}
          sx={{ borderRadius: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary="Sign Out" primaryTypographyProps={{ fontWeight: 500, fontSize: 14 }} />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* AppBar (mobile only) */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          display: { md: "none" },
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ color: "text.primary" }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "text.primary", ml: 1 }}>
            HMD<span style={{ color: theme.palette.primary.main }}>.bio</span>
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Sidebar Drawer */}
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: "background.default",
          p: { xs: 2, sm: 3 },
          mt: { xs: 8, md: 0 },
          minHeight: "100vh",
          overflow: "auto",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
