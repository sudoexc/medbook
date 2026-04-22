import { UsersIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function PatientsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Пациенты"
        subtitle="Фаза 2a — TODO: список пациентов"
      />
      <EmptyState
        icon={<UsersIcon />}
        title="База пациентов"
        description="Поиск, фильтры по сегменту/тегам, быстрый переход в карточку пациента."
      />
    </PageContainer>
  )
}
