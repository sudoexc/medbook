import { ClipboardListIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function AppointmentsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Записи"
        subtitle="Фаза 2b — TODO: таблица записей с фильтрами"
      />
      <EmptyState
        icon={<ClipboardListIcon />}
        title="Список записей будет здесь"
        description="TanStack Table с фильтрами, сортировкой и быстрыми действиями."
      />
    </PageContainer>
  )
}
