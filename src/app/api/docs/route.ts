import { NextResponse } from "next/server";
import { openApiPublicSpec } from "@/lib/api/openapi-public";

export function GET() {
  return NextResponse.json(openApiPublicSpec);
}
