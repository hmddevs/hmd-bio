import { NextRequest, NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi";
import { requireAuth } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";

// src/lib/openapi.ts documents the full API (including admin-only
// endpoints) in one spec, served publicly at /api/docs — API schemas
// aren't secrets. This route is a redundant, admin-gated alias kept for
// backwards compatibility with anything still pointed at it.
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimit(`admin-docs:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  return NextResponse.json(openApiSpec);
}
