/**
 * /api/crm/doctors/[id]/time-off — list, create, delete (by query ?entryId=).
 * See docs/TZ.md §6.6.
 *
 * Create answers with `affectedAppointments` (visits already booked inside
 * the window) so the UI can warn and send the admin to reschedule; create
 * and delete both emit `doctor.scheduleChanged` (audit DR-06, see
 * `@/server/doctors/time-off`). Reasons («больничный») are shown to the
 * admin and to the doctor himself only (audit DR-09).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, forbidden, parseQuery, err } from "@/server/http";
import {
  CreateTimeOffSchema,
  QueryTimeOffSchema,
} from "@/server/schemas/doctor";
import type { TenantContext } from "@/lib/tenant-context";
import { doctorAudience } from "@/server/doctors/doctor-view";
import {
  createDoctorTimeOff,
  deleteDoctorTimeOff,
  type TimeOffActor,
} from "@/server/doctors/time-off";

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

function timeOffActor(ctx: TenantContext): TimeOffActor {
  const isDoctor = ctx.kind === "TENANT" && ctx.role === "DOCTOR";
  return {
    actorId: ctx.kind === "TENANT" || ctx.kind === "SUPER_ADMIN" ? ctx.userId : null,
    actorRole: isDoctor ? "DOCTOR" : "ADMIN",
    surface: isDoctor ? "DOCTOR_CABINET" : "CRM",
  };
}

/** The admin, or the doctor whose leave it is. */
async function canSeeTimeOffReason(
  ctx: TenantContext,
  doctorId: string,
): Promise<boolean> {
  const audience = doctorAudience(ctx);
  if (audience === "admin") return true;
  if (audience !== "doctor" || ctx.kind !== "TENANT") return false;
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { userId: true },
  });
  return doctor?.userId === ctx.userId;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
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
    const showReason = await canSeeTimeOffReason(ctx, doctorId);
    return ok({
      rows: showReason ? rows : rows.map((r) => ({ ...r, reason: null })),
    });
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
    const { created, affected } = await createDoctorTimeOff({
      clinicId: doctor.clinicId,
      doctorId,
      startAt: body.startAt,
      endAt: body.endAt,
      reason: body.reason ?? null,
      actor: timeOffActor(ctx),
    });
    await audit(request, {
      action: "doctor.timeoff.create",
      entityType: "DoctorTimeOff",
      entityId: created.id,
      meta: {
        after: created,
        ...(affected.count > 0 ? { affectedAppointments: affected.count } : {}),
      },
    });
    return ok({ ...created, affectedAppointments: affected }, 201);
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
    const removed = await deleteDoctorTimeOff({
      clinicId: doctor.clinicId,
      doctorId,
      entryId,
      actor: timeOffActor(ctx),
    });
    if (!removed) return notFound();
    await audit(request, {
      action: "doctor.timeoff.delete",
      entityType: "DoctorTimeOff",
      entityId: entryId,
    });
    return ok({ id: entryId, deleted: true });
  }
);
