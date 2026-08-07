import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain } from "@/models/Domain";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { normaliseHost } from "@/lib/domains";
import { transition, IllegalDomainTransitionError } from "@/lib/domain-state";
import { invalidateDomainStatus } from "@/lib/domain-cache";
import { recordAudit } from "@/lib/audit";

type SuspendAction = "suspend" | "unsuspend";
const VALID_ACTIONS: SuspendAction[] = ["suspend", "unsuspend"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimitCaller("admin-domains-patch", session);
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const { hostname: rawHostname } = await params;
    const hostname = normaliseHost(rawHostname);
    if (!hostname) return apiError("Invalid hostname", 400);

    let body: { action?: unknown; reason?: unknown };
    try {
      body = await request.json();
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const action = body.action;
    if (typeof action !== "string" || !VALID_ACTIONS.includes(action as SuspendAction)) {
      return apiError("`action` must be one of: suspend, unsuspend", 400);
    }
    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

    await connectDB();

    const domain = await Domain.findOne({ hostname });
    if (!domain) return apiError("Domain not found", 404);

    const statusBefore = domain.status;

    try {
      // Only touch suspendedReason/suspendedAt when the status is actually
      // changing. Re-entering the same status is a no-op success in
      // transition(), and this keeps it a true no-op here too — a repeat
      // "suspend" call does not silently overwrite the original reason or
      // timestamp with the new call's values.
      if (action === "suspend") {
        if (domain.status !== "suspended") {
          domain.suspendedReason = reason;
          domain.suspendedAt = new Date();
        }
        await transition(domain, "suspended");
      } else {
        if (domain.status !== "active") {
          domain.suspendedReason = null;
          domain.suspendedAt = null;
        }
        await transition(domain, "active");
      }
    } catch (err) {
      if (err instanceof IllegalDomainTransitionError) {
        return apiError(
          `Cannot ${action} a domain in status "${err.from}"`,
          409
        );
      }
      throw err;
    }

    await invalidateDomainStatus(hostname);

    // Suspending takes a customer's live domain out of service, so it is
    // recorded whether or not it changed anything: a repeat call is a no-op for
    // the domain but still an administrator reaching for the switch.
    await recordAudit({
      request,
      actor: session.user,
      action: action === "suspend" ? "admin.domain.suspend" : "admin.domain.unsuspend",
      subjectType: "domain",
      subjectIds: [domain.hostname],
      route: "admin/domains/[hostname]:PATCH",
      detail: {
        statusBefore,
        statusAfter: domain.status,
        // The reason the administrator gave, not derived from any visitor data.
        reason,
        owner: domain.owner ? domain.owner.toString() : null,
      },
    });

    return apiSuccess({
      hostname: domain.hostname,
      status: domain.status,
      linkCount: domain.linkCount,
      verifiedAt: domain.verifiedAt ?? null,
      failureReason: domain.failureReason ?? null,
      suspendedReason: domain.suspendedReason ?? null,
      suspendedAt: domain.suspendedAt ?? null,
      createdAt: domain.createdAt,
    });
  } catch (err) {
    captureError(err, { route: "admin/domains/[hostname]:PATCH" });
    return apiError("Internal server error", 500);
  }
}
