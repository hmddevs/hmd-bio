/**
 * Scope decisions for API keys.
 *
 * Pure module: no database access, no Next.js types, no environment reads
 * beyond what `@/lib/domains` already does. Every authorisation decision an
 * API key drives is made by a function in here, so the rules can be tested
 * exhaustively without standing up a request.
 *
 * Three properties this module has to hold, in order of importance:
 *
 * 1. Backwards compatibility. A key minted before scoping existed has none of
 *    these fields. It must resolve to exactly what it was: full access, every
 *    domain, no expiry. "Absent" therefore has to mean "unrestricted", and is
 *    the one place where absent is not treated as suspicious.
 * 2. Fail closed on anything present but unrecognised. An absent scope is a
 *    legacy key; a scope of `"admin"` or `"rw"` is a value we do not understand
 *    and must refuse, because the alternative is guessing in the permissive
 *    direction on a value we did not write.
 * 3. No unrepresentable-state ambiguity. "Restricted to no domains at all" is
 *    deliberately not expressible: the creation path stores either a non-empty
 *    list or no list, so an empty list can safely mean "no restriction was
 *    configured" rather than "deny everything". See `resolveKeyDomains`.
 */

import { normaliseHost } from "@/lib/domains";

/** Scope values that may be persisted on a key. */
export const API_KEY_SCOPES = ["read", "write"] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * The scope a caller actually operates under. `none` is never stored: it is
 * what an unrecognised stored value resolves to, and it permits nothing.
 */
export type EffectiveScope = ApiKeyScope | "none";

/** How the caller proved who they are. */
export type AuthVia = "session" | "api-key";

export interface CallerAccess {
  via: AuthVia;
  scope: EffectiveScope;
  /**
   * Hostnames the caller may touch, already normalised. `null` means every
   * domain the account owns, which is the legacy and default behaviour.
   */
  domains: readonly string[] | null;
  /**
   * Which key authenticated the request, as the subdocument's `_id` string.
   * `null` for a session.
   *
   * Identity only, never authority: no authorisation decision reads this. It
   * exists so the rate limiter can give each key its own bucket, which is why
   * it is the `_id` and not the hash or the prefix. Putting the hash here
   * would push a credential into every log line that records a bucket key.
   */
  keyId: string | null;
}

/**
 * An interactive session is the account itself, so it carries no restriction.
 * Scoping exists to limit a credential handed to a third party; a person
 * signed in to the dashboard is not that.
 */
export const SESSION_ACCESS: CallerAccess = Object.freeze({
  via: "session",
  scope: "write",
  domains: null,
  keyId: null,
});

/**
 * The persisted shape this module reads. Declared structurally rather than
 * importing the Mongoose interface so the decision logic stays testable with
 * plain objects, including the shapes Mongoose would never produce (a legacy
 * document, or a value edited directly in the database).
 */
export interface StoredKeyScoping {
  scope?: string | null;
  domains?: readonly unknown[] | null;
  expiresAt?: Date | string | number | null;
}

export type KeyAccessResult =
  | { ok: true; access: CallerAccess }
  | { ok: false; reason: "expired" };

/** Identity of the key being resolved, kept separate from its scoping fields. */
export interface StoredKeyIdentity {
  keyId?: string | null;
}

/**
 * Coerce a stored expiry to a Date.
 *
 * Returns `undefined` for "no expiry set" and `null` for "a value is set but
 * cannot be read as a date". The two must not collapse: the first grants a
 * non-expiring key, the second is corrupt and has to deny.
 */
function readExpiry(value: StoredKeyScoping["expiresAt"]): Date | null | undefined {
  if (value === null || value === undefined) return undefined;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Resolve the stored scope string.
 *
 * Absent means a key from before scoping existed, which had full access, so it
 * resolves to `write`. Anything present that is not a known scope resolves to
 * `none` and will be refused everywhere.
 */
export function resolveKeyScope(value: StoredKeyScoping["scope"]): EffectiveScope {
  if (value === null || value === undefined) return "write";
  if (value === "read" || value === "write") return value;
  return "none";
}

/**
 * Resolve the stored domain restriction.
 *
 * Absent, or an empty list, means no restriction was configured: `null`. A
 * non-empty list means a restriction was intended, so if none of its entries
 * survive normalisation the result is an empty list, which permits nothing.
 * That asymmetry is the point. An unreadable restriction must never widen into
 * unrestricted access.
 */
export function resolveKeyDomains(
  value: StoredKeyScoping["domains"]
): readonly string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return []; // present but not a list: deny everything
  if (value.length === 0) return null; // no restriction was expressed

  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const host = normaliseHost(entry);
    if (host) hosts.push(host);
  }
  return hosts;
}

/**
 * Turn a stored key into the access context the request runs under, or reject
 * it outright when it has expired.
 *
 * Expiry is a rejection rather than a zero-scope access because an expired
 * credential is not a credential: the caller is unauthenticated (401), not
 * authenticated-and-refused (403).
 */
export function resolveKeyAccess(
  key: StoredKeyScoping & StoredKeyIdentity,
  now: Date = new Date()
): KeyAccessResult {
  const expiresAt = readExpiry(key.expiresAt);
  if (expiresAt === null) return { ok: false, reason: "expired" }; // unreadable, so refuse
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    access: {
      via: "api-key",
      scope: resolveKeyScope(key.scope),
      domains: resolveKeyDomains(key.domains),
      keyId: key.keyId ?? null,
    },
  };
}

/**
 * Methods that cannot change state. Everything else, including a method we do
 * not recognise, requires write scope.
 *
 * Deriving the requirement from the method rather than from a per-route
 * declaration is deliberate: a route added later is covered the moment it
 * exists, and there is nothing for its author to remember. The failure mode of
 * this rule is a POST that only reads being refused to a read-only key, which
 * is a false denial and safe. The failure mode of a per-route declaration is a
 * write that nobody annotated being allowed, which is a hole.
 */
const READ_ONLY_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export function requiredScopeForMethod(method: string | null | undefined): ApiKeyScope {
  if (typeof method !== "string") return "write";
  return READ_ONLY_METHODS.has(method.toUpperCase()) ? "read" : "write";
}

/** True when the caller's scope covers the operation being attempted. */
export function scopePermits(access: CallerAccess, required: ApiKeyScope): boolean {
  if (access.scope === "write") return true;
  if (access.scope === "read") return required === "read";
  return false;
}

/**
 * True when the caller may act on `domain`.
 *
 * A caller whose scope resolved to `none` is refused here too, so a single
 * missed scope check upstream cannot become a domain-level bypass.
 */
export function accessPermitsDomain(
  access: CallerAccess,
  domain: string | null | undefined
): boolean {
  if (access.scope === "none") return false;
  if (access.domains === null) return true;

  const target = normaliseHost(domain ?? "");
  if (!target) return false;
  return access.domains.includes(target);
}

/**
 * A Mongoose filter fragment restricting a list query to the caller's domains.
 * Empty when the caller is unrestricted, so it can be spread unconditionally.
 *
 * `field` differs by collection: links carry `domain`, Domain documents carry
 * `hostname`.
 */
export function domainScopeFilter(
  access: CallerAccess,
  field: "domain" | "hostname" = "domain"
): Record<string, unknown> {
  if (access.domains === null) return {};
  return { [field]: { $in: [...access.domains] } };
}

/**
 * How a key is described back to its owner. Mirrors `resolveKeyAccess` so the
 * dashboard can never show a key as more or less capable than it actually is.
 */
export interface ApiKeyScopeSummary {
  scope: EffectiveScope;
  domains: readonly string[] | null;
  expiresAt: string | null;
  expired: boolean;
}

export function summariseKeyScope(
  key: StoredKeyScoping,
  now: Date = new Date()
): ApiKeyScopeSummary {
  const expiresAt = readExpiry(key.expiresAt);
  const result = resolveKeyAccess(key, now);

  return {
    scope: result.ok ? result.access.scope : "none",
    domains: resolveKeyDomains(key.domains),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired: !result.ok,
  };
}
