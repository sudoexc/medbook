import { SendIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function TelegramPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Telegram Inbox"
        subtitle="Фаза 3b — TODO: входящие чаты"
      />
      <EmptyState
        icon={<SendIcon />}
        title="Входящие сообщения"
        description="Список чатов, активный чат, панель пациента. Real-time по SSE."
      />
    </PageContainer>
  )
}
