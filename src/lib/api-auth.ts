import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

export interface AuthSession {
  user: {
    id: string;
    name?: string | null;
    role?: string;
  };
}

export type AuthResult =
  | { ok: true; session: AuthSession }
  | { ok: false; response: Response };

/**
 * Resolves the current caller via a NextAuth session cookie OR a Bearer
 * `hmd_*` API key (delegates to `authenticateRequest`, which tries the
 * session first). Pass the route's `request` so Bearer-key auth is
 * possible — omitting it restricts the caller to session-cookie auth only.
 * Returns a discriminated result: on failure, `response` is a ready-to-return
 * 401; on success, `session` is guaranteed to have `user.id`.
 *
 * Usage:
 *   const result = await requireAuth(request);
 *   if (!result.ok) return result.response;
 *   const { session } = result;
 */
export async function requireAuth(request?: NextRequest): Promise<AuthResult> {
  const user = await authenticateRequest(request);
  if (!user) {
    return { ok: false, response: apiError("Unauthorized", 401) };
  }
  return { ok: true, session: { user } };
}

interface OwnableDoc {
  owner?: { toString(): string } | string | null;
}

interface RequireOwnershipOptions {
  /** Allow users with the admin role to bypass the ownership check. Defaults to true. */
  allowAdmin?: boolean;
}

/**
 * Checks that `session.user.id` owns `doc` (compared via `doc.owner`), or
 * that the session belongs to an admin when `allowAdmin` is enabled.
 * Returns a ready-to-return 403 Response on failure, or null when the check
 * passes.
 *
 * Usage:
 *   const forbidden = requireOwnership(link, session);
 *   if (forbidden) return forbidden;
 */
export function requireOwnership(
  doc: OwnableDoc,
  session: AuthSession,
  options: RequireOwnershipOptions = {}
): Response | null {
  const { allowAdmin = true } = options;

  if (allowAdmin && session.user.role === "admin") {
    return null;
  }

  const ownerId = doc.owner ? doc.owner.toString() : null;
  if (ownerId && ownerId === session.user.id) {
    return null;
  }

  return apiError("Forbidden — you do not own this resource", 403);
}
