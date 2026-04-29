"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      forcedTheme="dark"
      enableColorScheme={false}
    >
      {children}
    </NextThemesProvider>
  );
}
