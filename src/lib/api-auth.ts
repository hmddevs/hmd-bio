import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import {
  SESSION_ACCESS,
  accessPermitsDomain,
  type CallerAccess,
} from "@/lib/api-key-scope";

export interface AuthSession {
  user: {
    id: string;
    name?: string | null;
    role?: string;
  };
  /**
   * What the credential behind this request may do. Always present, so a route
   * never has to ask whether it was a session or a key: the session case is
   * simply the unrestricted access context.
   */
  access: CallerAccess;
}

export type AuthResult =
  | { ok: true; session: AuthSession }
  | { ok: false; response: Response };

/**
 * Resolves the current caller via a NextAuth session cookie OR a Bearer
 * `hmd_*` API key (delegates to `authenticateRequest`, which tries the
 * session first). Pass the route's `request` so Bearer-key auth is
 * possible — omitting it restricts the caller to session-cookie auth only.
 *
 * Read/write scope is already enforced by `authenticateRequest`, keyed off the
 * request method, so nothing here or in any route needs to repeat it. What a
 * route does still get is `session.access`, which carries any per-domain
 * restriction for the two places that can only be decided once a domain is
 * known: `requireOwnership` (single resource) and `checkDomainWritable`
 * (creating on a domain). List endpoints spread `domainScopeFilter` into their
 * query.
 *
 * Returns a discriminated result: on failure, `response` is a ready-to-return
 * 401 for a missing or expired credential, or 403 for a valid credential whose
 * scope forbids the operation.
 *
 * Usage:
 *   const result = await requireAuth(request);
 *   if (!result.ok) return result.response;
 *   const { session } = result;
 */
export async function requireAuth(request?: NextRequest): Promise<AuthResult> {
  const result = await authenticateRequest(request);

  if (!result.ok) {
    if (result.reason === "forbidden-scope") {
      return {
        ok: false,
        response: apiError(
          "This API key is read-only and cannot perform write operations",
          403
        ),
      };
    }
    return { ok: false, response: apiError("Unauthorized", 401) };
  }

  const { caller } = result;
  return {
    ok: true,
    session: {
      user: { id: caller.id, name: caller.name, role: caller.role },
      access: caller.access,
    },
  };
}

/**
 * Refuses a caller who authenticated with an API key, whatever its scope.
 *
 * For the handful of operations that manage the credentials themselves. A key
 * that could mint keys could mint a broader one, so privilege escalation is
 * prevented by making the operation unreachable by key at all rather than by
 * comparing requested scope against held scope. There is no comparison to get
 * wrong.
 */
export function requireSession(session: AuthSession): Response | null {
  if (session.access.via !== "session") {
    return apiError(
      "This endpoint cannot be used with an API key",
      403
    );
  }
  return null;
}

interface OwnableDoc {
  owner?: { toString(): string } | string | null;
  /** Links carry the hostname they live on here. */
  domain?: string | null;
  /** Domain documents carry it here. */
  hostname?: string | null;
}

interface RequireOwnershipOptions {
  /** Allow users with the admin role to bypass the ownership check. Defaults to true. */
  allowAdmin?: boolean;
  /**
   * Body text for the 404 returned when a domain-restricted key addresses a
   * resource outside its domains. Should match the route's own "not found"
   * wording so the two are indistinguishable to a caller probing for
   * existence.
   */
  notFoundMessage?: string;
}

/**
 * Checks that the caller may act on `doc`: that they own it (or are an admin
 * with `allowAdmin` enabled), and that the credential's domain restriction, if
 * any, covers the domain the document lives on.
 *
 * The domain check runs first and answers 404, not 403. A key confined to one
 * domain must not be able to confirm that a link exists on another, and 403
 * would confirm it. This mirrors the existing posture of not distinguishing
 * "absent" from "not yours".
 *
 * Every route that reads a single link or domain already calls this before
 * acting, which is why the restriction is enforced here rather than at each
 * call site: there is no additional step for a route to remember.
 *
 * Usage:
 *   const forbidden = requireOwnership(link, session, { notFoundMessage: "Link not found" });
 *   if (forbidden) return forbidden;
 */
export function requireOwnership(
  doc: OwnableDoc,
  session: AuthSession,
  options: RequireOwnershipOptions = {}
): Response | null {
  const { allowAdmin = true, notFoundMessage = "Not found" } = options;

  // Only when a restriction is actually configured, so an unrestricted caller
  // (every session, and every legacy key) reaches exactly the code it did
  // before. When one is configured, a document that carries no domain at all
  // is refused rather than waved through: we cannot show it is in scope.
  if (session.access.domains !== null) {
    const resourceDomain = doc.domain ?? doc.hostname ?? null;
    if (!accessPermitsDomain(session.access, resourceDomain)) {
      return apiError(notFoundMessage, 404);
    }
  }

  if (allowAdmin && session.user.role === "admin") {
    return null;
  }

  const ownerId = doc.owner ? doc.owner.toString() : null;
  if (ownerId && ownerId === session.user.id) {
    return null;
  }

  return apiError("Forbidden — you do not own this resource", 403);
}

/**
 * The access context for a caller who reached a route without going through
 * `requireAuth`, i.e. an interactive session resolved by `auth()` directly.
 * Exported so those routes can build an `AuthSession` without inventing their
 * own notion of unrestricted access.
 */
export const UNRESTRICTED_ACCESS = SESSION_ACCESS;
