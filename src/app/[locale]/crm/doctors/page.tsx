import { StethoscopeIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function DoctorsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Врачи"
        subtitle="Фаза 2d — TODO: аналитика и расписание врачей"
      />
      <EmptyState
        icon={<StethoscopeIcon />}
        title="Список врачей и KPI"
        description="Занятость, выручка, NPS, свободные слоты."
      />
    </PageContainer>
  )
}
