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
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
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

/**
 * Resolve the on-behalf-of patient id and confirm the active context can
 * see the appointment. Returns the appointment row + the resolved
 * patientId, or `null` if access is denied.
 */
async function loadAppointmentForContext(
  appointmentId: string,
  ctx: MiniAppContext,
  onBehalfOf: string | null,
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
    }
  | { kind: "not_found" }
  | { kind: "forbidden" }
> {
  // Resolve "acting as" patient. If `onBehalfOf` is provided, verify the
  // owner controls that family link in the same clinic.
  let effectivePatientId = ctx.patientId;
  if (onBehalfOf && onBehalfOf !== ctx.patientId) {
    const link = await prisma.patientFamily.findFirst({
      where: {
        clinicId: ctx.clinicId,
        ownerPatientId: ctx.patientId,
        linkedPatientId: onBehalfOf,
      },
      select: { id: true },
    });
    if (!link) return { kind: "forbidden" };
    effectivePatientId = onBehalfOf;
  }

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
  if (appt.patientId !== effectivePatientId) return { kind: "forbidden" };
  return { kind: "ok", appt, effectivePatientId };
}

const QuerySchema = z.object({
  onBehalfOf: z.string().optional(),
});

function parseOnBehalfOf(request: Request): string | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get("onBehalfOf");
  const parsed = QuerySchema.safeParse({ onBehalfOf: raw ?? undefined });
  if (!parsed.success) return null;
  return parsed.data.onBehalfOf ?? null;
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const appointmentId = segments[segments.length - 1] ?? "";
  if (!appointmentId) return err("missing_appointment_id", 400);

  const onBehalfOf = parseOnBehalfOf(request);
  const result = await loadAppointmentForContext(
    appointmentId,
    ctx,
    onBehalfOf,
  );
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

    const onBehalfOf = parseOnBehalfOf(request);
    const loaded = await loadAppointmentForContext(
      appointmentId,
      ctx,
      onBehalfOf,
    );
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
    // can never leave the dedupe column in a misleading state.
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
          preVisitData: blob as never,
          preVisitSubmittedAt: now,
        },
      });
    });

    await audit(request, {
      action: AUDIT_ACTION.PRE_VISIT_QUESTIONNAIRE_SUBMITTED,
      entityType: "Appointment",
      entityId: loaded.appt.id,
      meta: {
        patientId: loaded.effectivePatientId,
        complaintsLen: body.complaints.length,
        allergiesCount: body.allergies.length,
        medicationsCount: body.medications.length,
        notesLen: body.notes.length,
        locale: blob.locale,
        source: "tg-miniapp",
      },
    });

    return ok({ ok: true, submittedAt: now });
  },
);
