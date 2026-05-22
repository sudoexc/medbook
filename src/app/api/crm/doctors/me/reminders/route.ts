/**
 * GET  /api/crm/doctors/me/reminders — list this doctor's reminders.
 * POST /api/crm/doctors/me/reminders — create a reminder.
 *
 * "Reminders" = the doctor's own task list (позвонить пациенту, перезаказать
 * анализы, проверить рецепт). Always scoped to `doctorId = session.userId`
 * — admins use a different list endpoint when one lands.
 *
 * Default GET filter is "actionable now":
 *   status IN (PENDING, SNOOZED) AND remindAt <= now() + 24h
 * — surfaces what to do today on /doctor/my-day without dragging in every
 * future reminder. Pass `?status=ALL` (or any explicit status) to override.
 *
 * Pagination is cursor-based (limit+1 sentinel + cursor on id) to match the
 * other /doctors/me list endpoints, so the /doctor/notifications list can
 * scroll past the first page when a doctor has 100+ outstanding reminders.
 * The response also returns `totals` per status — the UI surfaces these on
 * tab badges so counters stay honest while only the first page is loaded.
 *
 * SSE: `reminder.created` on POST, `reminder.updated` on PATCH/DELETE (see
 * sibling [id]/route.ts).
 *
 * Audit: REMINDER_CREATED on POST.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, parseQuery } from "@/server/http";

const REMINDER_STATUSES = ["PENDING", "DONE", "DISMISSED", "SNOOZED"] as const;

const ListQuery = z.object({
  status: z
    .enum([...REMINDER_STATUSES, "ALL"] as [string, ...string[]])
    .optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(5000).optional().nullable(),
  remindAt: z.string().datetime({ offset: true }),
  patientId: z.string().min(1).optional().nullable(),
  appointmentId: z.string().min(1).optional().nullable(),
});

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, ListQuery);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const now = new Date();
    const horizon = new Date(now);
    horizon.setHours(horizon.getHours() + 24);

    const where: Record<string, unknown> = { doctorId: ctx.userId };
    const isAll = !q.status || q.status === "ALL";
    if (q.status && q.status !== "ALL") {
      where.status = q.status;
    } else if (!isAll) {
      // Reserved branch — current schema makes this unreachable, but keeps
      // the intent explicit if we later split "actionable now" from "ALL".
      where.status = { in: ["PENDING", "SNOOZED"] };
      where.remindAt = { lte: horizon };
    }
    // ALL mode (used by /doctor/notifications) returns every reminder so the
    // tab UI can bucket client-side. Filtered modes narrow at the DB.

    const take = q.limit + 1;
    const rows = await prisma.reminder.findMany({
      where,
      orderBy: [{ remindAt: "asc" }, { id: "asc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        title: true,
        body: true,
        remindAt: true,
        status: true,
        completedAt: true,
        patientId: true,
        appointmentId: true,
        createdAt: true,
        // Patient name is the only enrichment — appointment metadata is
        // surfaced lazily on the visit page if the doctor clicks through.
        patient: { select: { id: true, fullName: true } },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    // Totals per status — drives tab badges on /doctor/notifications so the
    // counters stay accurate while only the first page is in memory. A single
    // groupBy is cheap vs four separate counts.
    const grouped = await prisma.reminder.groupBy({
      by: ["status"],
      where: { doctorId: ctx.userId },
      _count: { _all: true },
    });
    const totals = {
      PENDING: 0,
      SNOOZED: 0,
      DONE: 0,
      DISMISSED: 0,
    } as Record<(typeof REMINDER_STATUSES)[number], number>;
    for (const g of grouped) {
      if (g.status in totals) {
        totals[g.status as (typeof REMINDER_STATUSES)[number]] =
          g._count._all;
      }
    }

    return ok({
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        remindAt: r.remindAt.toISOString(),
        status: r.status,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        patientId: r.patientId,
        appointmentId: r.appointmentId,
        patientFullName: r.patient?.fullName ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
      totals,
    });
  },
);

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // Anti-leak — the patient (if specified) must belong to this clinic. The
    // tenant Prisma extension scopes by clinicId automatically, so a foreign
    // patientId just returns null here.
    if (body.patientId) {
      const exists = await prisma.patient.findFirst({
        where: { id: body.patientId },
        select: { id: true },
      });
      if (!exists) return err("BadRequest", 400, { reason: "patient_not_found" });
    }
    // Same check for the optional appointment link; we additionally require
    // the appointment to involve this doctor so the reminder isn't pointed
    // at a colleague's visit.
    if (body.appointmentId) {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row" });
      const exists = await prisma.appointment.findFirst({
        where: { id: body.appointmentId, doctorId: doctor.id },
        select: { id: true },
      });
      if (!exists) {
        return err("BadRequest", 400, { reason: "appointment_not_found" });
      }
    }

    const created = await prisma.reminder.create({
      data: {
        clinicId: ctx.clinicId,
        doctorId: ctx.userId,
        patientId: body.patientId ?? null,
        appointmentId: body.appointmentId ?? null,
        title: body.title,
        body: body.body ?? null,
        remindAt: new Date(body.remindAt),
      },
      select: {
        id: true,
        title: true,
        body: true,
        remindAt: true,
        status: true,
        patientId: true,
        appointmentId: true,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.REMINDER_CREATED,
      entityType: "Reminder",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        appointmentId: created.appointmentId,
        remindAt: created.remindAt.toISOString(),
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "reminder.created",
      payload: {
        reminderId: created.id,
        doctorId: ctx.userId,
        patientId: created.patientId,
      },
    });

    return ok(
      {
        id: created.id,
        title: created.title,
        body: created.body,
        remindAt: created.remindAt.toISOString(),
        status: created.status,
        patientId: created.patientId,
        appointmentId: created.appointmentId,
      },
      201,
    );
  },
);
