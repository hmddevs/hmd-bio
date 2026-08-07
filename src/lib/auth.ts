import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { verifyTurnstile } from "@/lib/utils";
import { hashApiKey } from "@/lib/api-keys";
import { captureError } from "@/lib/errors";
import {
  SESSION_ACCESS,
  requiredScopeForMethod,
  resolveKeyAccess,
  scopePermits,
  type CallerAccess,
} from "@/lib/api-key-scope";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        await connectDB();
        const login = (credentials.username as string).trim();
        const isEmail = login.includes("@");

        const user = isEmail
          ? await User.findOne({ email: login.toLowerCase() })
          : await User.findOne({ username: login });
        if (!user) return null;

        if (!user.isVerified) return null;
        if (user.status !== "approved") return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        return {
          id: user._id.toString(),
          name: user.username,
          role: user.role,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = (token.role as string) ?? "user";
      }
      return session;
    },
  },
});

export interface AuthenticatedCaller {
  id: string;
  name: string;
  /**
   * The role the request runs as, which is not always the account's role. An
   * API key is always downgraded to "user"; see below.
   */
  role: string;
  access: CallerAccess;
}

/**
 * Why authentication produced no caller.
 *
 * `unauthenticated` is a 401: there was no usable credential, which includes an
 * expired key, because an expired credential is no credential.
 * `forbidden-scope` is a 403: the credential is valid and identifies a real
 * account, but does not permit the operation being attempted.
 */
export type AuthFailureReason = "unauthenticated" | "forbidden-scope";

export type AuthenticationResult =
  | { ok: true; caller: AuthenticatedCaller }
  | { ok: false; reason: AuthFailureReason };

/**
 * Authenticate a request via session cookie OR API key (Bearer token), and
 * decide in the same step whether the credential permits this request's method.
 *
 * The scope check lives here, not in the routes, and is derived from
 * `request.method` rather than from anything a route declares. That is the
 * whole design: there is no annotation for a new route to forget, and the
 * reserved-keyword list is the cautionary tale for what per-route copies of a
 * rule turn into. Domain-level restriction cannot be decided here, because the
 * domain is not known until the resource is loaded; it is carried on
 * `caller.access` and applied by `requireOwnership` and `checkDomainWritable`.
 *
 * Returns a discriminated result so that both callers (`requireAuth` and
 * `/api/v1/shorten`) are forced by the type checker to distinguish "no caller"
 * from "caller refused". Collapsing the two would let a read-only key fall
 * through to the anonymous path on `/api/v1/shorten` and create links anyway.
 */
export async function authenticateRequest(
  request?: NextRequest
): Promise<AuthenticationResult> {
  // 1. Try session auth first. A signed-in person is the account itself, so no
  //    scoping applies and their real role is preserved.
  const session = await auth();
  if (session?.user) {
    return {
      ok: true,
      caller: {
        id: session.user.id!,
        name: session.user.name!,
        role: session.user.role ?? "user",
        access: SESSION_ACCESS,
      },
    };
  }

  // 2. Try API key via Authorization header
  if (!request) return { ok: false, reason: "unauthenticated" };
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer hmd_")) {
    return { ok: false, reason: "unauthenticated" };
  }

  const apiKey = authHeader.slice(7); // "Bearer " = 7 chars
  await connectDB();

  const keyHash = hashApiKey(apiKey);
  const user = await User.findOne({ "apiKeys.keyHash": keyHash }).lean();
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (!user.isVerified || user.status !== "approved") {
    return { ok: false, reason: "unauthenticated" };
  }

  // The query matched the user, not the individual key, so find the key that
  // actually matched before reading any scoping off it. Picking the wrong
  // element would apply one key's restrictions to another key's request.
  const matched = user.apiKeys.find((candidate) => candidate.keyHash === keyHash);
  if (!matched) return { ok: false, reason: "unauthenticated" };

  const resolved = resolveKeyAccess({ ...matched, keyId: matched._id?.toString() ?? null });
  if (!resolved.ok) return { ok: false, reason: "unauthenticated" }; // expired

  if (!scopePermits(resolved.access, requiredScopeForMethod(request.method))) {
    return { ok: false, reason: "forbidden-scope" };
  }

  return {
    ok: true,
    caller: {
      id: user._id.toString(),
      name: user.username,
      // An API key never carries its owner's administrative privilege. Admin
      // routes and the admin bypass in `requireOwnership` both branch on this
      // role, so downgrading it here disarms all of them at once rather than
      // relying on eight inline `role !== "admin"` checks staying in step. A
      // key is a delegated credential; delegating account access must not
      // delegate platform administration.
      role: "user",
      access: resolved.access,
    },
  };
}

/**
 * Require admin role. Returns a 403 Response if the user is not an admin, or null if OK.
 */
export function requireAdmin(
  user: { role: string }
): Response | null {
  if (user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }
  return null;
}

/**
 * Require a valid Turnstile token on the request.
 * Checks the provided token string, or falls back to X-Turnstile-Token header.
 * Returns a 403 Response if verification fails, or null if OK.
 * Skipped when TURNSTILE_SECRET_KEY is not configured (dev mode).
 */
export async function requireTurnstile(
  turnstileToken: string | null | undefined,
  request?: NextRequest
): Promise<Response | null> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    // A missing key is only ever acceptable on a local machine. On any deployed
    // environment it means the bot protection on a public endpoint is silently
    // absent, so refuse the request rather than wave it through. Skipping here
    // previously let automated signups through unchallenged.
    const isDeployed = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
    if (isDeployed) {
      captureError(new Error("TURNSTILE_SECRET_KEY is not configured on a deployed environment"), {
        route: "requireTurnstile",
      });
      return apiError("Verification is temporarily unavailable", 503);
    }
    return null; // local development only
  }

  const token = turnstileToken || request?.headers.get("x-turnstile-token");
  if (!token) {
    return apiError("Turnstile token required", 403);
  }

  const valid = await verifyTurnstile(token, secretKey);
  if (!valid) {
    return apiError("Turnstile verification failed", 403);
  }

  return null;
}
