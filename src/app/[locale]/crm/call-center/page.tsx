import { PhoneCallIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function CallCenterPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Call Center"
        subtitle="Фаза 3c — TODO: входящие и исходящие звонки"
      />
      <EmptyState
        icon={<PhoneCallIcon />}
        title="Модуль звонков"
        description="Очередь входящих, история, скрипты, ручной дайлер, интеграция с АТС."
      />
    </PageContainer>
  )
}
