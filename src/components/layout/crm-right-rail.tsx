"use client"

import * as React from "react"

import { RightRail } from "@/components/molecules/right-rail"
import { EmptyState } from "@/components/atoms/empty-state"
import { SparklesIcon } from "lucide-react"

export interface CrmRightRailProps {
  children?: React.ReactNode
  title?: React.ReactNode
  /** Hide the rail entirely. */
  hidden?: boolean
}

/**
 * Default right rail for CRM pages. Shows an EmptyState when pages don't
 * provide content so the slot still has visible structure in Phase 0.
 */
export function CrmRightRail({ children, title, hidden }: CrmRightRailProps) {
  if (hidden) return null
  return (
    <RightRail title={title} storageKey="crm:right-rail:collapsed">
      {children ?? (
        <EmptyState
          icon={<SparklesIcon />}
          title="Пусто"
          description="Страница пока не определяет быстрые действия."
        />
      )}
    </RightRail>
  )
}
