import { LayoutDashboardIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function ReceptionPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Ресепшн"
        subtitle="Фаза 2c — TODO: живой дашборд рецепции"
      />
      <EmptyState
        icon={<LayoutDashboardIcon />}
        title="Дашборд рецепции появится позже"
        description="Модуль отвечает за живые KPI, очередь, Call Center и превью Telegram."
      />
    </PageContainer>
  )
}
