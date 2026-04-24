import * as React from "react"
import { getTranslations } from "next-intl/server"

import { CrmSidebar } from "@/components/layout/crm-sidebar"
import { CrmTopbar } from "@/components/layout/crm-topbar"
import { QueryProvider } from "@/components/providers/query-provider"

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("crmLayout")
  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <CrmSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <CrmTopbar userEmail="admin@neurofax.uz" userName={t("adminFallbackName")} />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  )
}
