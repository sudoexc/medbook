import { CurrentPatientCard } from "./_components/current-patient-card";
import { LiveQueueCard } from "./_components/live-queue-card";
import { RecentPatients } from "./_components/recent-patients";
import { ScheduleCard } from "./_components/schedule-card";
import { UpcomingPatients } from "./_components/upcoming-patients";

export default function MyDayPage() {
  return (
    <div className="grid auto-rows-min grid-cols-1 gap-4 p-4 xl:grid-cols-3 xl:gap-5 xl:p-6">
      {/* Focused doctor day (feedback): two-lanes on top — the schedule
          (bookings, «Начать») and the live walk-in queue («Вызвать») — with
          the «Следующий пациент» hero carrying the primary «Начать приём» +
          «Открыть карту». Everything else (tasks / results / referrals /
          reminders / drafts / AI / quick-actions) was intentionally stripped. */}
      <ScheduleCard />
      <LiveQueueCard />
      <CurrentPatientCard />

      {/* Clickable patient lists — each row/card opens the patient card
          (visit history, documents). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-3 xl:gap-5">
        <UpcomingPatients />
        <RecentPatients />
      </div>
    </div>
  );
}
