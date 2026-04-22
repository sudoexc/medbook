import { redirect } from "next/navigation";
import type * as React from "react";

import { auth } from "@/lib/auth";
import { QueryProvider } from "@/components/providers/query-provider";
import { AdminSidebar } from "./_components/admin-sidebar";
import { AdminTopbar } from "./_components/admin-topbar";

/**
 * /admin/* — SUPER_ADMIN control plane. Distinct layout from /crm/* — this
 * has no clinic sidebar, no tenant right-rail, and a dedicated admin palette.
 *
 * Guards:
 *   - Unauthenticated → /ru/login (NextAuth's sign-in page).
 *   - role !== SUPER_ADMIN → shown a 403 "denied" screen. We deliberately
 *     do not redirect other roles to `/crm` because that would leak the
 *     existence of `/admin` to a curious ADMIN. Instead we explain the
 *     restriction in-place.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/ru/login");
  }
  const role = session.user.role;
  if (role !== "SUPER_ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-semibold text-foreground">403 — Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Раздел <code className="rounded bg-muted px-1">/admin</code> доступен только администратору платформы
            (роль SUPER_ADMIN).
          </p>
          <p className="text-sm text-muted-foreground">
            <a
              href="/ru/crm"
              className="text-primary hover:underline"
            >
              Вернуться в CRM
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar
            userName={session.user.name ?? null}
            userEmail={session.user.email ?? null}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  );
}
