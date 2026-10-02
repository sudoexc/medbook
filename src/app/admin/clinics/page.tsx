import { ClinicsPageClient } from "./_components/clinics-page-client";

export const dynamic = "force-dynamic";

export default async function AdminClinicsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `?expired=1`: the CRM sent the operator back after a clinic visit's
  // lease ran out (audit G5-09, see `src/proxy.ts`).
  const { expired } = await searchParams;
  return <ClinicsPageClient expired={expired === "1"} />;
}
