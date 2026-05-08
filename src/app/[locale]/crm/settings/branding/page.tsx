/**
 * /crm/settings/branding — Phase 19 Wave 4 white-label.
 *
 * Server-component shell. Returns notFound() when the tenant lacks the
 * `hasWhiteLabel` flag (mirrors the "404 dark-launch" pattern). The form
 * itself is a client component because it deals with file inputs + colour
 * pickers.
 */
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getFeatureFlags } from "@/server/platform/get-feature-flags";

import { BrandingPageClient } from "./_components/branding-page-client";

export default async function BrandingPage() {
  const session = await auth();
  if (!session?.user) notFound();
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") notFound();
  const clinicId = session.user.clinicId;
  if (!clinicId) notFound();
  const flags = await runWithTenant(
    {
      kind: "TENANT",
      clinicId,
      userId: session.user.id,
      role,
    },
    () => getFeatureFlags(clinicId),
  );
  if (!flags.hasWhiteLabel) notFound();
  return <BrandingPageClient hasCustomSubdomain={flags.hasCustomSubdomain} />;
}
