"use client";

import { ThemeProvider, CssBaseline } from "@mui/material";
import { darkTheme } from "@/theme/mui-theme";

export default function MuiProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
