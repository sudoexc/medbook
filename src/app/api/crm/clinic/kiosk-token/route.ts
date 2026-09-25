/**
 * /api/crm/clinic/kiosk-token — pair the lobby kiosk (audit SEC-01).
 *
 *   GET    → whether a kiosk is paired, and since when
 *   POST   → issue a new device token; returns the kiosk link ONCE. Any
 *            previously paired tablet stops working at that moment.
 *   DELETE → switch the kiosk off (no tablet can call the kiosk APIs).
 *
 * ADMIN only. Only the token's sha256 is stored.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { SITE_DOMAIN } from "@/lib/constants";
import { forbidden, ok } from "@/server/http";
import { issueKioskToken } from "@/server/kiosk/device";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { kioskTokenHash: true, kioskTokenIssuedAt: true },
    });
    return ok({
      paired: Boolean(clinic?.kioskTokenHash),
      issuedAt: clinic?.kioskTokenIssuedAt ?? null,
    });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const { token, hash } = issueKioskToken();
    const now = new Date();
    const clinic = await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { kioskTokenHash: hash, kioskTokenIssuedAt: now },
      select: { slug: true },
    });
    await audit(request, {
      action: AUDIT_ACTION.KIOSK_TOKEN_ISSUED,
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { issuedAt: now.toISOString() },
    });
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${SITE_DOMAIN}`;
    // The token rides in the #fragment: browsers never send it to a server,
    // so it cannot land in nginx access logs or a Referer header.
    const url = `${base}/kiosk?c=${encodeURIComponent(clinic.slug)}#k=${encodeURIComponent(token)}`;
    return ok({ paired: true, issuedAt: now, url });
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { kioskTokenHash: null, kioskTokenIssuedAt: null },
    });
    await audit(request, {
      action: AUDIT_ACTION.KIOSK_TOKEN_REVOKED,
      entityType: "Clinic",
      entityId: ctx.clinicId,
    });
    return ok({ paired: false, issuedAt: null });
  },
);
