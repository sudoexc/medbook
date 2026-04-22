import { DoctorsPageClient } from "./_components/doctors-page-client";

/**
 * /crm/doctors — Phase 2d.
 * Server component is a thin shell; all list state (filters, grid, right rail,
 * period toggle) lives inside the client component backed by TanStack Query.
 *
 * See `docs/TZ.md` §6.6 and progress log Phase 2d for the end-to-end contract
 * (list endpoint, appointment aggregation window, right-rail widgets).
 */
export default function DoctorsPage() {
  return <DoctorsPageClient />;
}
