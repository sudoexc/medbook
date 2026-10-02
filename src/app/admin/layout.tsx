import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import type * as React from "react";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import {
  SUPER_ADMIN_ENROL_PATH,
  adminPageAccess,
} from "@/server/platform/admin-page-gate";
import { QueryProvider } from "@/components/providers/query-provider";
import { SessionExpiryWatch } from "@/components/auth/session-expiry-watch";
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
 *   - SUPER_ADMIN without enrolled 2FA → the enrolment page (audit SEC-08).
 *     Not a lockout: they enrol there and come back. Pages that load data on
 *     the server repeat the check (`adminPageAccess`).
 *
 * /admin lives outside the [locale] segment and its pages are plain Russian,
 * but the shared «enter clinic» dialog (audit CM-21) also runs in the CRM
 * topbar and reads next-intl. Like /login, the pages get a provider in the
 * browser's last language with only that namespace on the wire.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await adminPageAccess();
  if (access.kind === "anonymous") {
    redirect("/ru/login");
  }
  if (access.kind === "owes_mfa") {
    redirect(SUPER_ADMIN_ENROL_PATH);
  }
  if (access.kind === "forbidden") {
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

  const store = await cookies();
  const locale = store.get("NEXT_LOCALE")?.value === "uz" ? "uz" : "ru";
  const entry = (locale === "uz" ? uz : ru).adminPlatform.switcher.entry;

  return (
    <QueryProvider>
      {/* Idle timeout counts only real input (audit SEC-06): without the
          heartbeat a SUPER_ADMIN clicking through /admin would time out. */}
      <SessionExpiryWatch />
      <div className="flex h-screen min-h-0 w-full bg-background">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar
            userName={access.name}
            userEmail={access.email}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            <NextIntlClientProvider
              locale={locale}
              messages={{ adminPlatform: { switcher: { entry } } }}
            >
              {children}
            </NextIntlClientProvider>
          </main>
        </div>
      </div>
    </QueryProvider>
  );
}
