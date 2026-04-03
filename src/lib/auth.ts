import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";

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
    signIn: "/admin/login",
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

/**
 * Authenticate a request via session cookie OR API key (Bearer token).
 * Returns the authenticated user info or null.
 */
export async function authenticateRequest(
  request?: NextRequest
): Promise<{ id: string; name: string; role: string } | null> {
  // 1. Try session auth first
  const session = await auth();
  if (session?.user) {
    return {
      id: session.user.id!,
      name: session.user.name!,
      role: session.user.role ?? "user",
    };
  }

  // 2. Try API key via Authorization header
  if (!request) return null;
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer hmd_")) return null;

  const apiKey = authHeader.slice(7); // "Bearer " = 7 chars
  await connectDB();

  const user = await User.findOne({ "apiKeys.key": apiKey }).lean();
  if (!user) return null;
  if (!user.isVerified || user.status !== "approved") return null;

  return {
    id: user._id.toString(),
    name: user.username,
    role: user.role,
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
