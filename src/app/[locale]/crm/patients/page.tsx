import { PatientsPageClient } from "./_components/patients-page-client";

/**
 * /crm/patients — Phase 2a.
 * Server component is a thin shell; all interactive state (filters, table,
 * right-rail widgets, new-patient dialog) lives in the client component.
 * The initial list + stats are fetched on the client via TanStack Query so
 * filter changes don't require a full server round-trip.
 */
export default function PatientsPage() {
  return <PatientsPageClient />;
}
