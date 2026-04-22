import { CalendarPageClient } from "./_components/calendar-page-client";

/**
 * /crm/calendar — Phase 2b.
 *
 * Thin server shell — FullCalendar is browser-only, so the real implementation
 * lives in the client component (loaded with `dynamic(..., { ssr: false })`).
 *
 * Desktop-only by design (>= 1280 px). Smaller viewports see a gentle
 * fallback pointing to the paginated `/crm/appointments` table instead.
 */
export default function CalendarPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <CalendarPageClient />
    </div>
  );
}
