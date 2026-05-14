import { Suspense } from "react";

import { AgendaShell } from "./_components/agenda-shell";

export default async function DoctorSchedulePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    // AgendaShell reads `?date=YYYY-MM-DD` via useSearchParams for deep links.
    <Suspense fallback={null}>
      <AgendaShell locale={locale} />
    </Suspense>
  );
}
