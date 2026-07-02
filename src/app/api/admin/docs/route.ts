import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi";
import { requireAuth } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";

// NOTE: the old openApiPrivateSpec (which documented admin-only endpoints
// such as /api/v1/admin/users) no longer exists in the current src/lib/openapi.ts
// — only the public openApiSpec remains. Until that admin-only content is
// reinstated, this route now serves the same spec as the current, working
// src/app/api/docs/route.ts, gated behind an admin session. See summary.
export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimit(`admin-docs:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  return NextResponse.json(openApiSpec);
}
