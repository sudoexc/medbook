import { PatientCardClient } from "./_components/patient-card-client";

/**
 * /crm/patients/[id] — Phase 2a patient card.
 *
 * Server component is a thin shell; we delegate the actual fetch to
 * TanStack Query inside the client component so inline-edit + tab switches
 * stay on the cached record (no full server round-trip per keystroke).
 *
 * 404 handling lives in `PatientCardClient` — the `usePatient` query throws
 * a `NOT_FOUND` error which renders a friendly empty-state with a back
 * button, rather than a bare `notFound()` 404 page. This matches the UX on
 * the rest of the CRM (e.g. `appointments/[id]`) where context is kept.
 */
export default async function PatientCardPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  return <PatientCardClient id={id} />;
}
