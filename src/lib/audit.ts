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
export { isAdministrativeAccess } from "@/lib/audit-record";

/**
 * How long the audit write gets before the caller stops waiting for it.
 *
 * Every caller awaits `recordAudit` after its own operation has already
 * committed, so an unbounded wait here can only ever turn a succeeded
 * administrative action into a hung request and then a gateway 500. Two seconds
 * comfortably covers a healthy insert (single-digit milliseconds, plus a cold
 * connect) while keeping the worst case well inside any sane function timeout.
 */
export const AUDIT_WRITE_TIMEOUT_MS = 2000;

/**
 * What actually became of the entry.
 *
 * `recordAudit` has always computed this internally; it is surfaced so that the
 * one caller for which "no entry" is not acceptable can act on it. See the
 * comment on `recordAudit` for which callers may ignore it and why.
 */
export type AuditOutcome = "written" | "failed" | "timed-out";

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
 * Never throws, never rejects, and never waits longer than
 * `AUDIT_WRITE_TIMEOUT_MS`. Recording an action must not be able to fail the
 * action: an administrator suspending an abusive domain cannot be blocked
 * because the audit collection is unreachable, and neither rejection nor an
 * unresponsive connection may reach the caller. The four WRITE callers await
 * this only after their own operation has already committed, so failing the
 * request there would report a failure for work that actually happened, which
 * is worse than losing the entry.
 *
 * The returned `AuditOutcome` exists for the one caller where that reasoning
 * does not hold: `admin/clicks:GET` has disclosed nothing at the point it calls
 * this, so it can, and does, refuse to disclose rather than lose the entry. It
 * is the only caller that inspects the result.
 *
 * SECURITY TRADE-OFF, stated deliberately. A trail that can be skipped under
 * load is weaker evidence than one that cannot: it means "no entry" does not
 * strictly prove "no access". We accept that, because the alternative is a
 * database wobble taking administration offline, and we compensate by making
 * every miss loud where it can be counted. A timeout and a rejected write are
 * both reported to Sentry with the actor, action and subject count, so the
 * entry can be reconstructed from the event and a rising rate of
 * `stage: "audit-timeout"` is alertable. The one thing that must never happen,
 * a miss that nobody can see, does not.
 *
 * Callers should `await` this before returning their response. It is tempting
 * to fire and forget for the few milliseconds, but this runs on Vercel, where
 * the function is frozen once the response is sent, so an un-awaited write is
 * not merely unordered, it may never reach the database at all.
 */
export async function recordAudit(options: RecordAuditOptions): Promise<AuditOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // `writeAudit` resolves rather than rejects on every failure of its own, so
  // this race has exactly two outcomes: the write settled, or it ran out of
  // time. The losing promise is left to settle on its own; it holds no lock and
  // its own error handling still runs if it eventually completes.
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), AUDIT_WRITE_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([writeAudit(options), timeout]);
    if (outcome === "timeout") {
      captureError(
        new Error(`Audit write timed out after ${AUDIT_WRITE_TIMEOUT_MS}ms; entry may be lost.`),
        auditFailureContext(options, "audit-timeout")
      );
      return "timed-out";
    }
    return outcome;
  } finally {
    // Without this the pending timer keeps the serverless invocation awake for
    // the full window after the response has already been sent.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The write itself. Resolves on success and on every failure; never rejects. */
async function writeAudit(options: RecordAuditOptions): Promise<"written" | "failed"> {
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
    return "written";
  } catch (err) {
    captureError(err, auditFailureContext(options, "audit-write"));
    return "failed";
  }
}

/**
 * Enough to reconstruct a lost entry from the Sentry event alone. Never the
 * detail payload, which is caller-supplied and only redacted once it reaches
 * `buildAuditRecord`.
 */
function auditFailureContext(
  options: RecordAuditOptions,
  stage: "audit-write" | "audit-timeout"
): Record<string, unknown> {
  return {
    route: options.route,
    stage,
    auditAction: options.action,
    actorId: options.actor.id,
    subjectType: options.subjectType,
    subjectCount: options.subjectCount ?? options.subjectIds?.length ?? 0,
  };
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
