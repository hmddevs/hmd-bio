import { ImageResponse } from "next/og";

export const alt = "HMD.bio — Fast, reliable URL shortening";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          color: "white",
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            display: "flex",
          }}
        >
          <span>HMD</span>
          <span style={{ color: "#2563eb" }}>.bio</span>
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            marginTop: 16,
          }}
        >
          Fast, reliable URL shortening
        </div>
        <div
          style={{
            fontSize: 20,
            color: "#71717a",
            position: "absolute",
            bottom: 48,
          }}
        >
          by HMD Developments
        </div>
      </div>
    ),
    { ...size },
  );
}
