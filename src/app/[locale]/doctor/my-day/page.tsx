import { CurrentPatientCard } from "./_components/current-patient-card";
import { LiveQueueCard } from "./_components/live-queue-card";
import { ScheduleCard } from "./_components/schedule-card";

export default function MyDayPage() {
  return (
    <div className="grid auto-rows-min grid-cols-1 gap-4 p-4 xl:grid-cols-2 xl:gap-5 xl:p-6">
      {/* Three blocks, nothing else (design feedback — «проще»):
          1. who I'm seeing right now, full width, carrying the primary CTA;
          2-3. the two lanes side by side — booked schedule («Начать») and the
          walk-in live queue («Вызвать»).

          «Ближайшие пациенты» was dropped because it re-listed the very same
          bookings as the schedule card, and «Недавние пациенты» because that
          is what the Пациенты screen is for. */}
      <div className="xl:col-span-2">
        <CurrentPatientCard />
      </div>

      <ScheduleCard />
      <LiveQueueCard />
    </div>
  );
}
