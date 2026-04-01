"use client";

import { createTheme } from "@mui/material/styles";

const baseTheme = {
  typography: {
    fontFamily: "var(--font-geist-sans), sans-serif",
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: {
      defaultProps: { variant: "outlined" as const },
      styleOverrides: {
        root: { borderRadius: 16 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none" as const, fontWeight: 600, borderRadius: 10 },
      },
      defaultProps: { disableElevation: true },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: "rgba(128,128,128,0.15)" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none" as const, fontWeight: 600 },
      },
    },
  },
};

export const lightTheme = createTheme({
  ...baseTheme,
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
    background: { default: "#f5f5f5", paper: "#ffffff" },
  },
});

export const darkTheme = createTheme({
  ...baseTheme,
  palette: {
    mode: "dark",
    primary: { main: "#90caf9" },
    background: { default: "#0a0a0a", paper: "#141414" },
  },
});
