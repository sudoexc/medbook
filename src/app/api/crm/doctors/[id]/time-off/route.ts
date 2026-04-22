/**
 * /api/crm/doctors/[id]/time-off — list, create, delete (by query ?entryId=).
 * See docs/TZ.md §6.6.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, forbidden, parseQuery, err } from "@/server/http";
import {
  CreateTimeOffSchema,
  QueryTimeOffSchema,
} from "@/server/schemas/doctor";

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const doctorId = doctorIdFromUrl(request);
    const parsed = parseQuery(request, QueryTimeOffSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;
    const rows = await prisma.doctorTimeOff.findMany({
      where: {
        doctorId,
        ...(q.from ? { endAt: { gte: q.from } } : {}),
        ...(q.to ? { startAt: { lte: q.to } } : {}),
      },
      orderBy: { startAt: "asc" },
    });
    return ok({ rows });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: CreateTimeOffSchema },
  async ({ request, body, ctx }) => {
    const doctorId = doctorIdFromUrl(request);
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }
    if (body.endAt <= body.startAt) {
      return err("ValidationError", 400, { reason: "end_before_start" });
    }
    const created = await prisma.doctorTimeOff.create({
      data: {
        doctorId,
        startAt: body.startAt,
        endAt: body.endAt,
        reason: body.reason ?? null,
      } as never,
    });
    await audit(request, {
      action: "doctor.timeoff.create",
      entityType: "DoctorTimeOff",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const doctorId = doctorIdFromUrl(request);
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) return err("entryId required", 400);
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }
    await prisma.doctorTimeOff.delete({ where: { id: entryId } });
    await audit(request, {
      action: "doctor.timeoff.delete",
      entityType: "DoctorTimeOff",
      entityId: entryId,
    });
    return ok({ id: entryId, deleted: true });
  }
);
