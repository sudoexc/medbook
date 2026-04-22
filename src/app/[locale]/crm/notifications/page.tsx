import { BellIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function NotificationsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Уведомления"
        subtitle="Фаза 3a — TODO: центр и шаблоны уведомлений"
      />
      <EmptyState
        icon={<BellIcon />}
        title="Центр уведомлений"
        description="Шаблоны, история доставки, правила по событиям."
      />
    </PageContainer>
  )
}
