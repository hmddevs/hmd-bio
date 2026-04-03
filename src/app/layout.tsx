import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ThemeProvider from "@/components/providers/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://hmd.bio"),
  title: {
    default: "HMD.bio — URL Shortener",
    template: "%s | HMD.bio",
  },
  description:
    "Fast, reliable URL shortening by HMD Developments. Create short, branded links instantly.",
  keywords: [
    "url shortener",
    "link shortener",
    "short url",
    "hmd.bio",
    "branded links",
    "custom short links",
  ],
  authors: [{ name: "HMD Developments", url: "https://hmddevs.org" }],
  creator: "HMD Developments",
  publisher: "HMD Developments",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://hmd.bio",
    siteName: "HMD.bio",
    title: "HMD.bio — URL Shortener",
    description:
      "Fast, reliable URL shortening by HMD Developments. Create short, branded links instantly.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HMD.bio — URL Shortener",
    description:
      "Fast, reliable URL shortening by HMD Developments. Create short, branded links instantly.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <link rel="dns-prefetch" href="https://challenges.cloudflare.com" />
        <link rel="preconnect" href="https://challenges.cloudflare.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "HMD Developments",
              url: "https://hmddevs.org",
              logo: "https://hmd.bio/icon",
              sameAs: ["https://github.com/hmd-corp"],
            }),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
