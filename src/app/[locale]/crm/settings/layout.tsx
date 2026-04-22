import { redirect } from "next/navigation";
import type * as React from "react";

import { auth } from "@/lib/auth";
import { SettingsSidebar } from "./_components/settings-sidebar";

/**
 * /crm/settings/* — admin-only. All pages require role=ADMIN.
 * SUPER_ADMIN bypasses role checks at the API layer but — by policy — sees
 * only the tenant-scoped sections; the platform-only pages live under
 * `/admin/*` (built by `admin-platform-builder`).
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user) redirect("/login");
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    redirect("/crm");
  }
  return (
    <div className="flex min-h-0 flex-1">
      <SettingsSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
