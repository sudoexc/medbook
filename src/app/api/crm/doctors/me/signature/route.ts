/**
 * PUT    /api/crm/doctors/me/signature — set Doctor.signatureUrl.
 * DELETE /api/crm/doctors/me/signature — clear it.
 *
 * The actual byte upload is done by the client via `POST /api/crm/documents/upload`
 * (multipart). That endpoint stores the bytes through `uploadObject` (MinIO in
 * prod, local stub root in dev) and returns a real `fileUrl`. The client then
 * calls this endpoint with the URL to persist it on the Doctor row.
 *
 * We accept ANY URL — we don't validate that it's reachable or that it sits in
 * our bucket. A misuse here only hurts the doctor's own PDF; we keep
 * validation cheap.
 *
 * Audit: DOCTOR_SIGNATURE_SET on PUT, DOCTOR_SIGNATURE_REMOVED on DELETE.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const PutBody = z.object({
  signatureUrl: z.string().url().max(2000),
});

export const PUT = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PutBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("DoctorProfileMissing", 403);

    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { signatureUrl: body.signatureUrl },
    });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_SIGNATURE_SET,
      entityType: "Doctor",
      entityId: doctor.id,
      meta: { signatureUrl: body.signatureUrl },
    });

    return ok({ signatureUrl: body.signatureUrl });
  },
);

export const DELETE = createApiHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("DoctorProfileMissing", 403);

    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { signatureUrl: null },
    });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_SIGNATURE_REMOVED,
      entityType: "Doctor",
      entityId: doctor.id,
    });

    return ok({ ok: true });
  },
);
