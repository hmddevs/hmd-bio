import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 6,
          color: "white",
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: -0.5,
            display: "flex",
          }}
        >
          H
        </div>
        <div
          style={{
            width: 14,
            height: 2,
            backgroundColor: "#2563eb",
            borderRadius: 1,
            marginTop: 1,
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
