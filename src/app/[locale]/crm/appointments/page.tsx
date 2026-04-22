import { AppointmentsPageClient } from "./_components/appointments-page-client";

/**
 * /crm/appointments — Phase 2b.
 * Server component is a thin shell; all interactive state (filters, KPI
 * strip, virtualised table, bulk actions, row drawer, right rail, create
 * dialog) lives in the client component. Data is fetched on the client via
 * TanStack Query so filter changes never require a full server round-trip.
 */
export default function AppointmentsPage() {
  return <AppointmentsPageClient />;
}
