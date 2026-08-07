/**
 * Pure shaping and redaction for administrative audit entries.
 *
 * Deliberately free of Mongoose, Sentry and `process.env` so that the rules
 * that keep sensitive values out of the audit log can be tested directly, and
 * so `src/models/AuditLog.ts` can import the enums without a cycle. The write
 * itself lives in `src/lib/audit.ts`.
 */

export const AUDIT_ACTIONS = [
  // Access to a visitor's decrypted IP address. The reason this collection
  // exists at all.
  "admin.click_ip.decrypt",

  // Account lifecycle and privilege. `disable` hides an account, `promote`
  // hands out administrative access; both matter as much as a deletion.
  "admin.user.approve",
  "admin.user.disable",
  "admin.user.enable",
  "admin.user.verify",
  "admin.user.promote",
  "admin.user.demote",
  "admin.user.edit_profile",
  "admin.user.delete",

  // Taking a customer's domain out of service, and putting it back.
  "admin.domain.suspend",
  "admin.domain.unsuspend",

  // An administrator deleting a link they do not own, which also deletes every
  // click recorded against it.
  "admin.link.delete",
  // An administrator repointing or renaming a link they do not own. Arguably
  // worse than deleting it: a deletion is visible to everyone holding the URL,
  // whereas a repointed link keeps resolving and silently sends its traffic
  // somewhere else.
  "admin.link.edit",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Whether an action on an owned resource is an *administrative* access rather
 * than ordinary self-service.
 *
 * `requireOwnership` lets an administrator through on somebody else's link, so
 * the same handler serves both cases and only one of them belongs in the audit
 * trail. A user acting on their own link is not administrative access and must
 * not be recorded. Kept here, in one place, because the delete and edit paths
 * would otherwise each restate the condition and drift apart.
 *
 * An unowned resource (`ownerId === null`, a link detached when its owner was
 * deleted) counts as administrative: nobody can act on it as its owner.
 */
export function isAdministrativeAccess(
  actor: { id: string; role?: string | null },
  ownerId: string | null
): boolean {
  return actor.role === "admin" && ownerId !== actor.id;
}

export const AUDIT_SUBJECT_TYPES = ["click", "user", "domain", "link", "none"] as const;
export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number];

export type AuditDetailValue = string | number | boolean | null;
export type AuditDetail = Record<string, AuditDetailValue>;

export interface AuditRecordInput {
  actorId: string;
  actorUsername?: string | null;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectIds?: readonly string[];
  /** Total affected, when it exceeds what `subjectIds` can hold. */
  subjectCount?: number;
  route: string;
  method?: string | null;
  actorIpHash?: string | null;
  actorUserAgent?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditRecord {
  actorId: string;
  actorUsername: string;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectIds: string[];
  subjectCount: number;
  route: string;
  method: string;
  actorIpHash: string;
  actorUserAgent: string;
  detail: AuditDetail;
}

// A single admin clicks page tops out at 100 rows, so this holds a full page
// without truncating in normal use while still bounding a pathological caller.
export const MAX_SUBJECT_IDS = 100;
const MAX_DETAIL_KEYS = 12;
const MAX_STRING_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 256;
const MAX_SUBJECT_ID_LENGTH = 253; // longest legal hostname

export const REDACTED = "[redacted:ip]";

const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const TOKEN_SEPARATORS = /[\s,;()[\]"'<>]+/;

function looksLikeIpv6(value: string): boolean {
  for (const token of value.split(TOKEN_SEPARATORS)) {
    // Strip the bracket form used in URLs and any zone identifier.
    const candidate = token.replace(/^\[/, "").replace(/\]$/, "").replace(/%[\w.-]+$/, "");
    if (!candidate.includes(":")) continue;

    const groups = candidate.split(":");
    // Without a "::" compression, demand at least four colons. A clock time
    // ("12:34:56"), a route label ("admin/clicks:GET") and an ISO timestamp all
    // sit below that, so none of them trips the tripwire.
    if (!candidate.includes("::") && groups.length < 5) continue;
    if (groups.every((group) => group === "" || IPV6_GROUP.test(group))) return true;
  }
  return false;
}

/**
 * Tripwire for the one thing this collection must never hold. Callers are not
 * supposed to pass an address in the first place; this catches the case where
 * a future change starts forwarding a raw value into `detail`. Tuned to
 * over-redact rather than under-redact: a diagnostic field lost to a false
 * positive costs nothing next to an address written into the audit log.
 */
export function looksLikeIpAddress(value: string): boolean {
  return IPV4.test(value) || looksLikeIpv6(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function redactString(value: string, max: number): string {
  return truncate(looksLikeIpAddress(value) ? REDACTED : value, max);
}

function redactDetailValue(value: unknown): AuditDetailValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? redactString(trimmed, MAX_STRING_LENGTH) : undefined;
  }
  // Objects, arrays and functions are refused rather than serialised: nested
  // structures are how a sensitive field sneaks in unnoticed.
  return undefined;
}

/**
 * Normalises, caps and redacts an audit entry. Throws only on input that would
 * make the entry meaningless or unsafe (no actor, or a subject reference that
 * is itself an IP address); every other problem is handled by dropping or
 * truncating the offending field, because a partial entry beats no entry.
 */
export function buildAuditRecord(input: AuditRecordInput): AuditRecord {
  const actorId = (input.actorId ?? "").trim();
  if (!actorId) {
    throw new Error("Audit entry requires an actor id; an unattributed entry has no value.");
  }

  const subjectIds = (input.subjectIds ?? [])
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0)
    .map((id) => {
      if (looksLikeIpAddress(id)) {
        throw new Error(
          "Refusing to write an audit entry whose subject reference is an IP address."
        );
      }
      return truncate(id, MAX_SUBJECT_ID_LENGTH);
    })
    .slice(0, MAX_SUBJECT_IDS);

  const detail: AuditDetail = {};
  for (const [key, raw] of Object.entries(input.detail ?? {})) {
    if (Object.keys(detail).length >= MAX_DETAIL_KEYS) break;
    const value = redactDetailValue(raw);
    if (value !== undefined) detail[truncate(key, 40)] = value;
  }

  const actorIpHash = (input.actorIpHash ?? "").trim();
  if (actorIpHash && looksLikeIpAddress(actorIpHash)) {
    throw new Error("Refusing to write an audit entry holding an unhashed IP address.");
  }

  const declaredCount = input.subjectCount;
  const subjectCount =
    typeof declaredCount === "number" && Number.isFinite(declaredCount) && declaredCount >= 0
      ? Math.floor(declaredCount)
      : subjectIds.length;

  return {
    actorId,
    actorUsername: redactString((input.actorUsername ?? "").trim(), 64),
    action: input.action,
    subjectType: input.subjectType,
    subjectIds,
    subjectCount,
    route: truncate((input.route ?? "").trim(), 120),
    method: truncate((input.method ?? "").trim().toUpperCase(), 10),
    actorIpHash,
    actorUserAgent: redactString((input.actorUserAgent ?? "").trim(), MAX_USER_AGENT_LENGTH),
    detail,
  };
}
