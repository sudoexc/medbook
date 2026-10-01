/**
 * PATCH/DELETE /api/miniapp/appointments/[id]?clinicSlug=…[&onBehalfOf=…]
 *
 * Reschedule (startAt, doctorId?, serviceIds?) or cancel the patient's own
 * appointment, or one of a relative he acts for (`onBehalfOf`, checked
 * against the family link like every Mini App write, audit MA-18). A patient
 * cannot touch anybody else's rows: the visit must belong to the acting
 * patient, and a relative's only to his family owner.
 *
 * Phase M2 — both verbs publish through the outbox:
 *   • cancel → shared `cancelAppointment` kernel (appointment.cancelled +
 *     audit row), which refuses a visit already on the doctor's table
 *     (audit MA-15);
 *   • reschedule → shared `reschedulePatientAppointment` kernel (MA-16,
 *     MA-17): what may move, the grid, the horizon, prices and reminders.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";
import { createMiniAppHandler, type MiniAppContext } from "@/server/miniapp/handler";
import { toMiniAppAppointmentSummary } from "@/server/miniapp/appointment-view";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { cancelAppointment } from "@/server/appointments/cancel";
import { reschedulePatientAppointment } from "@/server/appointments/patient-reschedule";
import { MINIAPP_MAX_SERVICES_PER_BOOKING } from "@/lib/appointments/patient-booking";

const PatchBody = z
  .object({
    startAt: z.string().datetime().optional(),
    doctorId: z.string().min(1).max(64).optional(),
    serviceIds: z
      .array(z.string().min(1).max(64))
      .max(MINIAPP_MAX_SERVICES_PER_BOOKING)
      .optional(),
    cancel: z.boolean().optional(),
    cancelReason: z.string().max(500).optional(),
    // Older clients send the relative in the body; the query wins.
    onBehalfOf: z.string().min(1).max(64).optional(),
  })
  .refine(
    (v) => v.startAt || v.doctorId || v.serviceIds || v.cancel,
    { message: "nothing_to_update" },
  );

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * The acting patient (owner or linked relative) and the visit, which must be
 * his. Null visit → 404: a stranger's id and a missing one look the same.
 */
async function resolveOwnVisit(
  request: Request,
  ctx: MiniAppContext,
  bodyOnBehalfOf?: string,
): Promise<
  | { ok: true; patientId: string; onBehalfOfPatientId: string | null; id: string }
  | { ok: false; response: Response }
> {
  const id = idFromUrl(request);
  const onBehalfOf =
    new URL(request.url).searchParams.get("onBehalfOf") ?? bodyOnBehalfOf ?? null;
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return { ok: false, response: err(acting.reason, 403) };
  const visit = await prisma.appointment.findFirst({
    where: { id, clinicId: ctx.clinicId, patientId: acting.patientId },
    select: { id: true },
  });
  if (!visit) return { ok: false, response: notFound() };
  return {
    ok: true,
    patientId: acting.patientId,
    onBehalfOfPatientId: acting.isOnBehalfOf ? acting.patientId : null,
    id: visit.id,
  };
}

async function cancelOwnVisit(
  ctx: MiniAppContext,
  visit: { id: string; onBehalfOfPatientId: string | null },
  reason: string | null,
): Promise<Response> {
  const result = await cancelAppointment({
    appointmentId: visit.id,
    clinicId: ctx.clinicId,
    actorId: null,
    actorRole: "PATIENT",
    actorPatientId: ctx.patientId,
    actorOnBehalfOfPatientId: visit.onBehalfOfPatientId,
    actorLabel: `patient:${ctx.patientId}`,
    surface: "MINIAPP",
    reason,
  });
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    if (result.reason === "completed") return err("not_editable", 409);
    return err("not_cancellable", 409);
  }
  return ok({ appointment: toMiniAppAppointmentSummary(result.appointment) });
}

export const PATCH = createMiniAppHandler(
  { bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    const visit = await resolveOwnVisit(request, ctx, body.onBehalfOf);
    if (!visit.ok) return visit.response;

    if (body.cancel) {
      return cancelOwnVisit(ctx, visit, body.cancelReason?.trim() || null);
    }

    const result = await reschedulePatientAppointment({
      clinicId: ctx.clinicId,
      appointmentId: visit.id,
      patientId: visit.patientId,
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: visit.onBehalfOfPatientId,
        label: `patient:${ctx.patientId}`,
      },
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      doctorId: body.doctorId,
      serviceIds: body.serviceIds,
    });
    if (!result.ok) {
      if (result.status === 404 && result.reason === "NotFound") return notFound();
      // 409 keeps the `{ error: code }` shape the sheet maps to a text; a
      // slot clash also names when the doctor is free again.
      return err(result.reason, result.status, result.until ? { until: result.until } : undefined);
    }
    // Patient-safe fields only (audit MA-10): the kernel returns the full row.
    return ok({ appointment: toMiniAppAppointmentSummary(result.appointment) });
  },
);

export const DELETE = createMiniAppHandler({}, async ({ request, ctx }) => {
  const visit = await resolveOwnVisit(request, ctx);
  if (!visit.ok) return visit.response;

  // The patient may send `{ reason }` per TZ §5.3 to record WHY they cancelled.
  // The body is optional — older clients (and the detail-dialog cancel button
  // before the redesign) ship no body. We must NOT 400 on an empty body, just
  // treat it as "no reason given".
  let reason: string | null = null;
  try {
    const raw = await request.text();
    if (raw.length > 0) {
      const parsed = JSON.parse(raw) as { reason?: unknown };
      if (typeof parsed.reason === "string") {
        const trimmed = parsed.reason.trim().slice(0, 500);
        reason = trimmed.length > 0 ? trimmed : null;
      }
    }
  } catch {
    // Malformed JSON — fall through with reason=null rather than rejecting,
    // so the cancellation itself still goes through.
  }

  return cancelOwnVisit(ctx, visit, reason);
});
