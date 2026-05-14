import { Suspense } from "react";

import { PatientDetail } from "./_components/patient-detail";

export default async function DoctorPatientDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return (
    // `PatientDetail` reads `?tab=…` via `useSearchParams` for deep-link tabs.
    <Suspense fallback={null}>
      <PatientDetail locale={locale} patientId={id} />
    </Suspense>
  );
}
