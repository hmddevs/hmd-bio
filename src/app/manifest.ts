import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HMD.bio — URL Shortener",
    short_name: "HMD.bio",
    description: "Fast, reliable URL shortening by HMD Developments",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#2563eb",
    icons: [{ src: "/icon", sizes: "32x32", type: "image/png" }],
  };
}
