import { auth } from "@/lib/auth";
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
 * Resolves the current session via NextAuth's `auth()`. Callers get back a
 * discriminated result: on failure, `response` is a ready-to-return 401
 * NextResponse; on success, `session` is guaranteed to have `user.id`.
 *
 * Usage:
 *   const result = await requireAuth();
 *   if (!result.ok) return result.response;
 *   const { session } = result;
 */
export async function requireAuth(): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: apiError("Unauthorized", 401) };
  }
  return { ok: true, session: session as AuthSession };
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
