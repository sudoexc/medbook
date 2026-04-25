/**
 * Public clinic-scoped request helper.
 *
 * Used by:
 *   - `/api/c/[slug]/queue/*` (kiosk + TV + patient queue page)
 *
 * Unlike the Mini App handler this does NOT require Telegram auth — these
 * endpoints are consumed by a touch kiosk in the clinic lobby and a TV in
 * the waiting area. The trust model is "physically present at the clinic":
 * the slug is the bearer.
 *
 * Every handler runs inside a SYSTEM tenant scope and must explicitly
 * include `clinicId` in every Prisma query (no automatic tenant scoping
 * for public surfaces).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export type PublicClinicContext = {
  clinicId: string;
  clinicSlug: string;
  clinicNameRu: string;
  clinicNameUz: string;
};

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readSlug(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /api/c/[slug]/queue/...
  const idx = parts.indexOf("c");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export async function resolvePublicClinic(
  request: Request,
): Promise<{ ok: true; ctx: PublicClinicContext } | { ok: false; response: Response }> {
  const slug = readSlug(request);
  if (!slug) {
    return {
      ok: false,
      response: json(
        { error: "BadRequest", reason: "missing_clinic_slug" },
        { status: 400 },
      ),
    };
  }
  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: { id: true, slug: true, nameRu: true, nameUz: true, active: true },
  });
  if (!clinic || !clinic.active) {
    return {
      ok: false,
      response: json({ error: "NotFound", reason: "clinic" }, { status: 404 }),
    };
  }
  return {
    ok: true,
    ctx: {
      clinicId: clinic.id,
      clinicSlug: clinic.slug,
      clinicNameRu: clinic.nameRu,
      clinicNameUz: clinic.nameUz,
    },
  };
}

export function createPublicClinicHandler(
  handler: (args: {
    request: Request;
    ctx: PublicClinicContext;
  }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const resolved = await resolvePublicClinic(request);
    if (!resolved.ok) return resolved.response;
    return runWithTenant({ kind: "SYSTEM" }, () =>
      handler({ request, ctx: resolved.ctx }),
    );
  };
}
