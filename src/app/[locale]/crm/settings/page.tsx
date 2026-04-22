import { SettingsIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function SettingsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Настройки"
        subtitle="Фаза 4 — TODO: клиника и пользователи"
      />
      <EmptyState
        icon={<SettingsIcon />}
        title="Настройки"
        description="Клиника, пользователи, роли, интеграции, шаблоны документов."
      />
    </PageContainer>
  )
}
