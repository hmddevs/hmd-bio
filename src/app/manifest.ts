import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HMD.bio — URL Shortener",
    short_name: "HMD.bio",
    description: "Fast, reliable URL shortening by HMD Developments",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#90caf9",
    icons: [{ src: "/icon", sizes: "32x32", type: "image/png" }],
  };
}
