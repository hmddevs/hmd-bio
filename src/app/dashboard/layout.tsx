import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import MuiProvider from "@/components/providers/MuiProvider";
import UserShell from "@/components/dashboard/UserShell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/admin/login");
  }

  // Admins go to admin dashboard
  if (session.user.role === "admin") {
    redirect("/admin");
  }

  return (
    <SessionProvider session={session}>
      <MuiProvider>
        <UserShell>{children}</UserShell>
      </MuiProvider>
    </SessionProvider>
  );
}
