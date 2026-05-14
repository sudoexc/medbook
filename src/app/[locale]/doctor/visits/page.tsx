import { redirect } from "next/navigation";

/**
 * /doctor/visits (no patientId) → redirect to /doctor/patients. The visit
 * history view requires a patient context (Phase 2.2). The doctor picks a
 * patient from the list, then lands on /doctor/visits/[patientId].
 */
export default async function VisitsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/doctor/patients`);
}
