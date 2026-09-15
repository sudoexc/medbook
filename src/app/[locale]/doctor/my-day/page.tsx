import { CurrentPatientCard } from "./_components/current-patient-card";
import { LiveQueueCard } from "./_components/live-queue-card";
import { ScheduleCard } from "./_components/schedule-card";

export default function MyDayPage() {
  return (
    <div className="grid auto-rows-min grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:gap-5 xl:p-6">
      {/* Three blocks, nothing else (design feedback — «проще»):
          1. who I'm seeing right now, full width, carrying the primary CTA;
          2-3. the two lanes side by side — the walk-in live queue and the
          booked schedule.

          The split starts at `md`, not `xl`: the doctor's monitor renders
          below 1280px, so the xl breakpoint never engaged and the lanes
          stacked — the schedule ate the first screen while the live queue sat
          below the fold. Reported from the cabinet.

          Live queue goes FIRST (left): it is the lane that changes minute to
          minute and the one he actually works from; the booked schedule is
          reference material next to it.

          «Ближайшие пациенты» was dropped because it re-listed the very same
          bookings as the schedule card, and «Недавние пациенты» because that
          is what the Пациенты screen is for. */}
      <div className="md:col-span-2">
        <CurrentPatientCard />
      </div>

      <LiveQueueCard />
      <ScheduleCard />
    </div>
  );
}
