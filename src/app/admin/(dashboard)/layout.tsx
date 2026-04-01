import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/admin/login");
  }

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <AdminNav />
        <main className="flex-1 bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
