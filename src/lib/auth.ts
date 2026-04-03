import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { NextRequest } from "next/server";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        await connectDB();
        const user = await User.findOne({ username: credentials.username });
        if (!user) return null;

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
        session.user.role = (token.role as string) ?? "admin";
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
      role: session.user.role ?? "admin",
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

  return {
    id: user._id.toString(),
    name: user.username,
    role: user.role,
  };
}
