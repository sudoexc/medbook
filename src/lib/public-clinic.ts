/**
 * Server-side public-clinic resolver for anonymous routes.
 *
 * Public surfaces (kiosk, landing lead form, queue widgets) carry no
 * TenantContext — they run outside auth. To stay tenant-safe they must resolve
 * a concrete clinic and pass an explicit `clinicId` into every query (the same
 * pattern as `sip/event` and `c/[slug]/queue`). This centralises that lookup so
 * each route stops hand-rolling it.
 *
 * Resolution order mirrors the client hook `use-public-clinic-slug.ts`:
 *   ?c=<slug>  →  ?clinicSlug=<slug>  →  DEFAULT_CLINIC_SLUG
 *
 * The lookup runs in a SYSTEM context (Clinic is in MODELS_WITHOUT_TENANT and
 * we're outside `runWithTenant` on these routes anyway). Returns null when the
 * slug doesn't resolve to an active clinic — callers should 404/return empty.
 */
import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { DEFAULT_CLINIC_SLUG } from "./constants";

export type PublicClinic = { id: string; slug: string };

export async function resolvePublicClinic(
  request: Request,
): Promise<PublicClinic | null> {
  const url = new URL(request.url);
  const slug =
    url.searchParams.get("c") ??
    url.searchParams.get("clinicSlug") ??
    DEFAULT_CLINIC_SLUG;

  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findFirst({
      where: { slug, active: true },
      select: { id: true, slug: true },
    }),
  );
}
