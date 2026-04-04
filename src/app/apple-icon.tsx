import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: 36,
          color: "white",
        }}
      >
        <div
          style={{
            fontSize: 100,
            fontWeight: 800,
            letterSpacing: -3,
            display: "flex",
          }}
        >
          H
        </div>
        <div
          style={{
            width: 60,
            height: 5,
            backgroundColor: "#2563eb",
            borderRadius: 3,
            marginTop: 2,
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
