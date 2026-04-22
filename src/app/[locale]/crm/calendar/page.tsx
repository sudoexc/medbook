import { CalendarDaysIcon } from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { EmptyState } from "@/components/atoms/empty-state"

export default function CalendarPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Календарь"
        subtitle="Фаза 2b — TODO: календарь по врачам с drag-n-drop"
      />
      <EmptyState
        icon={<CalendarDaysIcon />}
        title="Календарь записей появится позже"
        description="FullCalendar или react-big-calendar, день/неделя/месяц, ресурсы — врачи."
      />
    </PageContainer>
  )
}
