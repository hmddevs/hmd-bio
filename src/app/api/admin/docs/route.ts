import { NextRequest, NextResponse } from "next/server";
import { openApiPrivateSpec } from "@/lib/api/openapi";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json(openApiPrivateSpec);
}
