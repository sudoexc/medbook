import { AIAssistant } from "./_components/ai-assistant";
import { CurrentPatientCard } from "./_components/current-patient-card";
import { DraftConclusions } from "./_components/draft-conclusions";
import { QuickActions } from "./_components/quick-actions";
import { RecentPatients } from "./_components/recent-patients";
import { Reminders } from "./_components/reminders";
import { ScheduleCard } from "./_components/schedule-card";
import { TodayTasks } from "./_components/today-tasks";
import { UnreadResults } from "./_components/unread-results";
import { UpcomingPatients } from "./_components/upcoming-patients";

export default function MyDayPage() {
  return (
    <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="grid min-w-0 flex-1 auto-rows-min grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <ScheduleCard />
        <CurrentPatientCard />
        <UpcomingPatients />

        <TodayTasks />
        <UnreadResults />
        <Reminders />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-3 xl:gap-5">
          <DraftConclusions />
          <RecentPatients />
        </div>
      </div>

      <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex xl:gap-5">
        <AIAssistant />
        <QuickActions />
      </aside>
    </div>
  );
}
