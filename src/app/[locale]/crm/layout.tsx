import * as React from "react"

import { CrmSidebar } from "@/components/layout/crm-sidebar"
import { CrmTopbar } from "@/components/layout/crm-topbar"
import { QueryProvider } from "@/components/providers/query-provider"

/**
 * CRM shell: sidebar (240px) + topbar (64px) + scrollable main.
 * The right rail is owned per-page: pages opt in by rendering `CrmRightRail`
 * (or a custom panel) inside their layout tree.
 *
 * Wraps children in a shared `QueryClientProvider` so CRM pages can use
 * TanStack Query for data fetching (patients/appointments/dashboard/...).
 *
 * Auth note: Phase 1 `api-builder` will wire in session-derived user data.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex h-screen min-h-0 w-full bg-background">
        <CrmSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <CrmTopbar userEmail="admin@neurofax.uz" userName="Администратор" />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  )
}
