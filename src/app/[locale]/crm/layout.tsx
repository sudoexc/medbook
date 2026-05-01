import * as React from "react"
import { cookies } from "next/headers"
import { getTranslations } from "next-intl/server"

import { auth } from "@/lib/auth"
import { CrmSidebar } from "@/components/layout/crm-sidebar"
import { CrmTopbar } from "@/components/layout/crm-topbar"
import { ImpersonationBanner } from "@/components/layout/impersonation-banner"
import { TrialBanner } from "@/components/layout/trial-banner"
import { QueryProvider } from "@/components/providers/query-provider"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/tenant-context"
import { ACTIVE_BRANCH_COOKIE_NAME } from "@/server/platform/branch-cookie"
import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags"
import { getCurrentSubscription } from "@/server/platform/current-subscription"

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("crmLayout")
  // We read the session here so the topbar (and the BranchSwitcher inside)
  // know who the user is. The hardcoded fallback values below preserve the
  // legacy demo-friendly render when the session is missing — pages enforce
  // their own auth, so the layout never blocks.
  const session = await auth()
  const cookieStore = await cookies()
  const branchCookie = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value || null
  // Phase 9d — resolve plan-aware nav flags once on the server. The sidebar
  // uses this to hide pro-only menu items; the gated `page.tsx` files run
  // their own `notFound()` guards as defense-in-depth.
  // Phase 9e — also resolve the current subscription so the trial / past-due
  // banner can render above the topbar. Both calls hit Postgres so we run
  // them in parallel to keep the layout fast on every CRM page.
  const [flags, subscription] = await Promise.all([
    getFeatureFlagsForCurrentSession(),
    getCurrentSubscription(),
  ])
  // Phase 4 — when a SUPER_ADMIN is browsing CRM with an active clinic
  // override, surface a yellow banner above the topbar with «Выйти» that
  // clears the cookie and returns to /admin/clinics. The banner is
  // intentionally sticky on every CRM page so impersonation can never be
  // forgotten while clicking around.
  let impersonatedClinic: { nameRu: string; slug: string } | null = null
  if (
    session?.user?.role === "SUPER_ADMIN" &&
    session.user.clinicId
  ) {
    impersonatedClinic = await runWithTenant(
      { kind: "SUPER_ADMIN", userId: session.user.id },
      () =>
        prisma.clinic.findUnique({
          where: { id: session.user.clinicId as string },
          select: { nameRu: true, slug: true },
        }),
    )
  }
  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <CrmSidebar flags={flags} />
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonatedClinic && (
            <ImpersonationBanner
              clinicName={impersonatedClinic.nameRu}
              clinicSlug={impersonatedClinic.slug}
            />
          )}
          <TrialBanner subscription={subscription} />
          <CrmTopbar
            userEmail={session?.user?.email ?? "admin@neurofax.uz"}
            userName={session?.user?.name ?? t("adminFallbackName")}
            userRole={session?.user?.role ?? null}
            currentClinicId={session?.user?.clinicId ?? null}
            currentBranchId={branchCookie}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  )
}
