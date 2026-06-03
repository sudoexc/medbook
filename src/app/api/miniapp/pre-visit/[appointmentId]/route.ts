/**
 * Phase 16 Wave 2 — Pre-visit questionnaire (Mini App).
 *
 * GET  /api/miniapp/pre-visit/:appointmentId
 *   Returns the appointment context (date, doctor) + already-saved
 *   `preVisitData` so the form prefills on edit.
 *
 * POST /api/miniapp/pre-visit/:appointmentId
 *   Body validated by `PreVisitSubmissionSchema`. Writes `preVisitData`
 *   (a JSON blob with `{complaints, allergies, medications, notes,
 *   locale}`) and stamps `preVisitSubmittedAt = now()`. Audit row
 *   `PRE_VISIT_QUESTIONNAIRE_SUBMITTED`. Resubmits overwrite the previous
 *   blob (no version history) — the doctor sees the latest answer in the
 *   CRM drawer.
 *
 * Ownership: the patient must own the appointment OR be linked via
 * `PatientFamily` (active relationships only). Mismatch → 403.
 */
import { prisma } from "@/lib/prisma";
import {
  PreVisitSubmissionSchema,
  parsePreVisitData,
  type PreVisitData,
} from "@/lib/patient-experience/pre-visit";
import { err, forbidden, notFound, ok } from "@/server/http";
import {
  createMiniAppHandler,
  createMiniAppListHandler,
  type MiniAppContext,
} from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

async function loadAppointmentForContext(
  appointmentId: string,
  ctx: MiniAppContext,
  request: Request,
): Promise<
  | {
      kind: "ok";
      appt: {
        id: string;
        clinicId: string;
        patientId: string;
        date: Date;
        status: string;
        preVisitData: unknown;
        preVisitSubmittedAt: Date | null;
        doctor: { nameRu: string; nameUz: string };
      };
      effectivePatientId: string;
      isOnBehalfOf: boolean;
    }
  | { kind: "not_found" }
  | { kind: "forbidden" }
> {
  const onBehalfOf = new URL(request.url).searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return { kind: "forbidden" };

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      date: true,
      status: true,
      preVisitData: true,
      preVisitSubmittedAt: true,
      doctor: { select: { nameRu: true, nameUz: true } },
    },
  });
  if (!appt) return { kind: "not_found" };
  if (appt.patientId !== acting.patientId) return { kind: "forbidden" };
  return {
    kind: "ok",
    appt,
    effectivePatientId: acting.patientId,
    isOnBehalfOf: acting.isOnBehalfOf,
  };
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const appointmentId = segments[segments.length - 1] ?? "";
  if (!appointmentId) return err("missing_appointment_id", 400);

  const result = await loadAppointmentForContext(appointmentId, ctx, request);
  if (result.kind === "not_found") return notFound();
  if (result.kind === "forbidden") return forbidden();

  const data = parsePreVisitData(result.appt.preVisitData);
  return ok({
    appointment: {
      id: result.appt.id,
      date: result.appt.date,
      status: result.appt.status,
      doctor: result.appt.doctor,
    },
    submittedAt: result.appt.preVisitSubmittedAt,
    data,
  });
});

export const POST = createMiniAppHandler(
  { bodySchema: PreVisitSubmissionSchema },
  async ({ request, body, ctx }) => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const appointmentId = segments[segments.length - 1] ?? "";
    if (!appointmentId) return err("missing_appointment_id", 400);

    const loaded = await loadAppointmentForContext(appointmentId, ctx, request);
    if (loaded.kind === "not_found") return notFound();
    if (loaded.kind === "forbidden") return forbidden();

    // Reject after the appointment has happened — pre-visit form is
    // useless once the doctor has seen the patient. We still allow up to
    // the appointment time itself.
    if (
      loaded.appt.status !== "BOOKED" &&
      loaded.appt.status !== "WAITING"
    ) {
      return err("appointment_not_open", 409, {
        reason: "appointment_not_open",
        status: loaded.appt.status,
      });
    }

    // Stamp + write the JSON blob in one transaction so a partial write
    // can never leave the dedupe column in a misleading state. Phase M2 —
    // publish `previsit.submitted` from the same tx; the envelope's
    // EVENT_META is auditable so the outbox pumper materialises the
    // AuditLog row (no more manual `audit()` call). Counts in the payload,
    // not the contents, so the cabinet refetch is opt-in.
    const now = new Date();
    const blob: PreVisitData = {
      complaints: body.complaints,
      allergies: body.allergies,
      medications: body.medications,
      notes: body.notes,
      locale: ctx.patient.preferredLang === "UZ" ? "uz" : "ru",
    };
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: loaded.appt.id },
        data: {
          preVisitData: blob,
          preVisitSubmittedAt: now,
        },
      });
      const envelope: EventEnvelopeInput = {
        correlationId: newCorrelationId(),
        actor: {
          role: "PATIENT",
          userId: null,
          patientId: ctx.patientId,
          onBehalfOfPatientId: loaded.isOnBehalfOf
            ? loaded.effectivePatientId
            : null,
          label: `patient:${ctx.patientId}`,
        },
        surface: "MINIAPP",
        tenantScope: {
          clinicId: ctx.clinicId,
          doctorId: undefined,
          patientId: loaded.effectivePatientId,
          appointmentId: loaded.appt.id,
        },
        type: "previsit.submitted",
        payload: {
          appointmentId: loaded.appt.id,
          patientId: loaded.effectivePatientId,
          complaintsLen: body.complaints.length,
          allergiesCount: body.allergies.length,
          medicationsCount: body.medications.length,
        },
      };
      await publishViaOutbox(tx, envelope);
    });

    return ok({ ok: true, submittedAt: now });
  },
);
