import * as React from "react"
import { cookies } from "next/headers"
import { getTranslations } from "next-intl/server"

import { auth } from "@/lib/auth"
import { CrmSidebar } from "@/components/layout/crm-sidebar"
import { CrmTopbar } from "@/components/layout/crm-topbar"
import { QueryProvider } from "@/components/providers/query-provider"
import { ACTIVE_BRANCH_COOKIE_NAME } from "@/server/platform/branch-cookie"
import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags"

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
  const flags = await getFeatureFlagsForCurrentSession()
  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <CrmSidebar flags={flags} />
        <div className="flex min-w-0 flex-1 flex-col">
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
