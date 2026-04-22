import { DoctorProfileClient } from "./_components/doctor-profile-client";

/**
 * /crm/doctors/[id] — Phase 2d doctor profile.
 *
 * Thin Server Component shell; the actual fetch lives in the client
 * component so tab switches + inline edits reuse the cached record.
 * Not-found handling renders a friendly EmptyState instead of notFound().
 */
export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  return <DoctorProfileClient id={id} />;
}
