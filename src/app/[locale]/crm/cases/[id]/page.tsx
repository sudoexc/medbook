import { CaseDetailClient } from "./_components/case-detail-client";

/**
 * /crm/cases/[id] — MedicalCase detail page.
 *
 * Standalone destination for the appointment drawer's case pill and the
 * chevrons in the patient card "Cases" tab. Mirrors the shell of
 * /crm/patients/[id]: thin server component delegates everything to the
 * client so inline-edit + status changes stay on the cached record without
 * a full server round-trip per keystroke.
 *
 * 404 handling lives inside `CaseDetailClient` — `useCase` throws
 * `NOT_FOUND` and renders a friendly empty-state with a link back to
 * /crm/patients (matches the patient card UX, never a bare `notFound()`).
 */
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  return <CaseDetailClient id={id} />;
}
