import { BarChart3Icon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function AnalyticsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Аналитика"
        subtitle="Фаза 4 — TODO: сводные метрики"
      />
      <EmptyState
        icon={<BarChart3Icon />}
        title="Аналитика"
        description="Выручка, конверсии, загрузка клиники, ретеншн пациентов."
      />
    </PageContainer>
  )
}
