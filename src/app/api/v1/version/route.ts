import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    version = pkg.version;
  } catch { /* fallback */ }

  return NextResponse.json({
    success: true,
    data: {
      version,
      node: process.version,
      uptime: Math.floor(process.uptime()),
    },
    statusCode: 200,
  });
}
