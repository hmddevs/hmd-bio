import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { captureError } from "@/lib/errors";
import { hashIP } from "@/lib/ip";
import { AuditLog } from "@/models/AuditLog";
import {
  buildAuditRecord,
  type AuditAction,
  type AuditSubjectType,
} from "@/lib/audit-record";

export type { AuditAction, AuditSubjectType } from "@/lib/audit-record";

interface AuditActor {
  id: string;
  name?: string | null;
}

export interface RecordAuditOptions {
  /** Used only for request context (method, admin IP hash, user agent). */
  request?: NextRequest | null;
  actor: AuditActor;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectIds?: readonly string[];
  subjectCount?: number;
  /** Route label, matching the convention used for `captureError`. */
  route: string;
  detail?: Record<string, unknown>;
}

/**
 * Writes one administrative audit entry.
 *
 * Never throws and never rejects. Recording an action must not be able to fail
 * the action: an administrator suspending an abusive domain cannot be blocked
 * because the audit collection is unreachable. A failed write is loud in
 * observability instead, reported to Sentry with enough context to reconstruct
 * what was missed, and silent to the caller.
 *
 * Callers should `await` this before returning their response. It is tempting
 * to fire and forget for the few milliseconds, but this runs on Vercel, where
 * the function is frozen once the response is sent, so an un-awaited write is
 * not merely unordered, it may never reach the database at all.
 */
export async function recordAudit(options: RecordAuditOptions): Promise<void> {
  const { request, actor, action, subjectType, subjectIds, subjectCount, route, detail } =
    options;

  try {
    const record = buildAuditRecord({
      actorId: actor.id,
      actorUsername: actor.name ?? "",
      action,
      subjectType,
      subjectIds,
      subjectCount,
      route,
      method: request?.method ?? "",
      // The administrator's own address, salted-hashed exactly as the rate
      // limiter hashes a visitor's. It attributes a session to a location
      // without storing an address, and it is the only handle on "this admin
      // account was used from somewhere it has never been used before".
      actorIpHash: adminIpHash(request),
      actorUserAgent: request?.headers.get("user-agent") ?? "",
      detail,
    });

    await connectDB();
    await AuditLog.create(record);
  } catch (err) {
    captureError(err, {
      route,
      stage: "audit-write",
      auditAction: action,
      // Enough to reconstruct the lost entry from Sentry alone. Never the
      // detail payload, which is caller-supplied.
      actorId: actor.id,
      subjectType,
      subjectCount: subjectCount ?? subjectIds?.length ?? 0,
    });
  }
}

function adminIpHash(request?: NextRequest | null): string {
  if (!request) return "";
  const raw = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  if (!raw) return "";
  // hashIP refuses to run without IP_HASH_SALT. That refusal must not take the
  // whole entry down with it: an entry missing the actor's IP hash is still
  // worth writing, so the failure is reported and the field left empty.
  try {
    return hashIP(raw);
  } catch (err) {
    captureError(err, { stage: "audit-actor-ip-hash" });
    return "";
  }
}
