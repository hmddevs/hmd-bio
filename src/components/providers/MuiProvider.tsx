"use client";

import { useMemo } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { useTheme } from "next-themes";
import { lightTheme, darkTheme } from "@/theme/mui-theme";

export default function MuiProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const muiTheme = useMemo(
    () => (resolvedTheme === "dark" ? darkTheme : lightTheme),
    [resolvedTheme]
  );

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
