/**
 * GET /api/miniapp/clinic?clinicSlug=…
 *
 * Public clinic metadata (name, logo, phone, address) — used by the Mini App
 * shell to render the header. No init-data required because the data is
 * already public on the marketing site.
 */
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { runWithTenant } from "@/lib/tenant-context";
import { storageKeyFromUrl } from "@/lib/storage-ref";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("clinicSlug");
  if (!slug) return err("missing_clinic_slug", 400);
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const clinic = await prisma.clinic.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameRu: true,
        nameUz: true,
        addressRu: true,
        addressUz: true,
        phone: true,
        email: true,
        workdayStart: true,
        workdayEnd: true,
        logoUrl: true,
        brandColor: true,
        tgBotUsername: true,
        active: true,
      },
    });
    if (!clinic || !clinic.active) return err("not_found", 404);
    // A logo uploaded in the CRM is stored as a bare bucket URL
    // (`${MINIO_PUBLIC_URL}/<bucket>/branding/…`). The bucket is private and
    // nginx no longer proxies MinIO at all (audit INF-07), so that URL is a
    // broken image: the shell shows its letter avatar instead. External
    // https logos pass through unchanged.
    const logoUrl = storageKeyFromUrl(clinic.logoUrl) ? null : clinic.logoUrl;
    return ok({ clinic: { ...clinic, logoUrl } });
  });
}
