/**
 * Phase 16 Wave 2 — Post-visit NPS submission (Mini App).
 *
 * GET  /api/miniapp/nps/:appointmentId
 *   Returns appointment context (date, doctor, completedAt) + the existing
 *   review row (if any) so the Mini App can prefill the "Спасибо!" state when
 *   the patient revisits the deeplink.
 *
 * POST /api/miniapp/nps/:appointmentId
 *   Body: `{ score: 1..10, comment?: string (max 500) }`. Writes a single
 *   `PatientReview` row scoped to (clinicId, patientId, appointmentId).
 *   Idempotent — a second submission for the same (patient, appointment)
 *   tuple returns 409 with `reason: "already_submitted"` (the existing
 *   review row id is included so the UI can navigate to a "thank you"
 *   confirmation).
 *
 *   When `score < clinic.npsAlertThreshold` (default 7), we additionally:
 *     1. Stamp the review row with `adminAlerted = true,
 *        adminAlertedAt = now()`.
 *     2. Emit a `LOW_NPS_RECEIVED` Action via `upsertAction` so the admin's
 *        Action Center surfaces the unhappy patient. Dedupe key is keyed
 *        off `appointmentId`, severity 'high' (default), assignee role
 *        ADMIN. The Action emit runs inside a TENANT tenant scope because
 *        `upsertAction` relies on the Prisma extension to clinic-scope its
 *        finds/upserts.
 *     3. Audit `LOW_NPS_RECEIVED` (the always-on `NPS_RECEIVED` audit row
 *        is materialised by the outbox pumper from the `nps.submitted`
 *        envelope — no need for a second `audit()` call here).
 *
 * Phase M2 — `nps.submitted` envelope is published inside the review
 * insert tx so CRM KPI strip + NPS table refresh live; the pumper writes
 * the AuditLog row (`event:nps.submitted`) because EVENT_META marks it
 * auditable.
 *
 * Ownership: the patient must own the appointment OR be linked via
 * `PatientFamily` (active relationships only). Mismatch → 403.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { runWithTenant } from "@/lib/tenant-context";
import type { LowNpsReceivedPayload } from "@/lib/actions/types";
import { upsertAction } from "@/server/actions/repository";
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

const NpsSubmissionSchema = z.object({
  score: z.number().int().min(1).max(10),
  comment: z.string().max(500).optional().default(""),
});

type NpsBody = z.infer<typeof NpsSubmissionSchema>;

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
        completedAt: Date | null;
        doctorId: string | null;
        doctor: { id: string; nameRu: string; nameUz: string };
      };
      effectivePatientId: string;
      isOnBehalfOf: boolean;
      npsAlertThreshold: number;
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
      completedAt: true,
      doctorId: true,
      doctor: { select: { id: true, nameRu: true, nameUz: true } },
    },
  });
  if (!appt) return { kind: "not_found" };
  if (appt.patientId !== acting.patientId) return { kind: "forbidden" };

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { npsAlertThreshold: true },
  });
  const npsAlertThreshold = clinic?.npsAlertThreshold ?? 7;

  return {
    kind: "ok",
    appt,
    effectivePatientId: acting.patientId,
    isOnBehalfOf: acting.isOnBehalfOf,
    npsAlertThreshold,
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

  const existing = await prisma.patientReview.findFirst({
    where: {
      clinicId: ctx.clinicId,
      appointmentId: result.appt.id,
      patientId: result.effectivePatientId,
    },
    select: { id: true, score: true, comment: true, respondedAt: true },
    orderBy: { respondedAt: "desc" },
  });

  return ok({
    appointment: {
      id: result.appt.id,
      date: result.appt.date,
      status: result.appt.status,
      completedAt: result.appt.completedAt,
      doctor: {
        id: result.appt.doctor.id,
        nameRu: result.appt.doctor.nameRu,
        nameUz: result.appt.doctor.nameUz,
      },
    },
    review: existing,
  });
});

export const POST = createMiniAppHandler(
  { bodySchema: NpsSubmissionSchema },
  async ({ request, body, ctx }) => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const appointmentId = segments[segments.length - 1] ?? "";
    if (!appointmentId) return err("missing_appointment_id", 400);

    const loaded = await loadAppointmentForContext(appointmentId, ctx, request);
    if (loaded.kind === "not_found") return notFound();
    if (loaded.kind === "forbidden") return forbidden();

    // We accept submissions for any appointment status — even non-COMPLETED
    // ones in case the worker's clock-skew ever fires the trigger early. The
    // duplicate guard below stops abuse.
    const existing = await prisma.patientReview.findFirst({
      where: {
        clinicId: ctx.clinicId,
        appointmentId: loaded.appt.id,
        patientId: loaded.effectivePatientId,
      },
      select: { id: true },
    });
    if (existing) {
      return err("already_submitted", 409, {
        reason: "already_submitted",
        reviewId: existing.id,
      });
    }

    const typedBody = body as NpsBody;
    const score = typedBody.score;
    const comment = (typedBody.comment ?? "").trim();
    const lowScore = score < loaded.npsAlertThreshold;
    const now = new Date();

    // Single transaction: we do not want to leave a low-NPS row without its
    // adminAlerted stamp since the Action emit downstream is what wakes the
    // admin up. Phase M2 — also publishes `nps.submitted` through the outbox
    // so CRM KPI strip + NPS table refresh live; the envelope is auditable,
    // so the legacy `NPS_RECEIVED` audit() call below is now redundant for
    // the materialised AuditLog (the pumper writes it via EVENT_META). We
    // keep the legacy call until Phase F so reports that query the old
    // shape don't regress.
    const correlationId = newCorrelationId();
    const review = await prisma.$transaction(async (tx) => {
      const row = await tx.patientReview.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: loaded.effectivePatientId,
          appointmentId: loaded.appt.id,
          doctorId: loaded.appt.doctorId ?? null,
          score,
          comment: comment.length > 0 ? comment : null,
          source: "tg-miniapp",
          adminAlerted: lowScore,
          adminAlertedAt: lowScore ? now : null,
          respondedAt: now,
        },
        select: {
          id: true,
          score: true,
          comment: true,
          respondedAt: true,
        },
      });
      const envelope: EventEnvelopeInput = {
        correlationId,
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
          doctorId: loaded.appt.doctorId ?? undefined,
          patientId: loaded.effectivePatientId,
          appointmentId: loaded.appt.id,
        },
        type: "nps.submitted",
        payload: {
          appointmentId: loaded.appt.id,
          patientId: loaded.effectivePatientId,
          score,
          hasComment: comment.length > 0,
        },
      };
      await publishViaOutbox(tx, envelope);
      return row;
    });

    // ── Action Center emit when low-score (defence-in-depth: even if the
    //    upsert fails we already have the review row + adminAlerted stamp,
    //    so the admin sees the alert via the doctor analytics page).
    let actionEmittedId: string | null = null;
    if (lowScore) {
      try {
        // Build the patient + doctor display names. The patient's `fullName`
        // may legitimately be empty for half-onboarded patients — fall back
        // to the TG first/last name from the verified initData.
        const patientDisplay =
          ctx.patient.fullName ||
          [ctx.tgUser.first_name, ctx.tgUser.last_name]
            .filter(Boolean)
            .join(" ") ||
          "—";
        const doctorDisplay =
          ctx.patient.preferredLang === "UZ"
            ? loaded.appt.doctor.nameUz || loaded.appt.doctor.nameRu
            : loaded.appt.doctor.nameRu || loaded.appt.doctor.nameUz;

        // 120-char preview with ellipsis on truncate; never store the
        // full comment in the action payload (PII minimisation).
        const trimmed = comment;
        const commentPreview =
          trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;

        const payload: LowNpsReceivedPayload = {
          type: "LOW_NPS_RECEIVED",
          patientId: loaded.effectivePatientId,
          patientName: patientDisplay,
          appointmentId: loaded.appt.id,
          doctorId: loaded.appt.doctorId,
          doctorName: doctorDisplay || "—",
          score,
          commentPreview,
        };

        // upsertAction relies on the Prisma extension's tenant scope for its
        // findUnique on (clinicId, dedupeKey) — wrap in a TENANT context.
        const emit = await runWithTenant(
          {
            kind: "TENANT",
            clinicId: ctx.clinicId,
            userId: "system:miniapp-nps",
            role: "ADMIN",
          },
          () => upsertAction(prisma, ctx.clinicId, payload),
        );
        actionEmittedId = emit.id;

        await audit(request, {
          action: AUDIT_ACTION.LOW_NPS_RECEIVED,
          entityType: "Action",
          entityId: emit.id,
          meta: {
            patientId: loaded.effectivePatientId,
            onBehalfOfPatientId: loaded.isOnBehalfOf
              ? loaded.effectivePatientId
              : null,
            appointmentId: loaded.appt.id,
            score,
            threshold: loaded.npsAlertThreshold,
          },
        });
      } catch (e) {
        // Action emit / audit failure must NOT roll back the review write —
        // the rating is still recorded, the admin will just discover the
        // unhappy patient through the doctor-analytics page rather than the
        // Action Center.
        console.error("[miniapp/nps] LOW_NPS_RECEIVED emit failed", e);
      }
    }

    return ok({
      ok: true,
      reviewId: review.id,
      score: review.score,
      adminAlerted: lowScore,
      actionId: actionEmittedId,
    });
  },
);
