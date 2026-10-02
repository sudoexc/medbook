/**
 * /api/crm/appointments/[id] — get, patch (status/time/doctor reschedule),
 * delete (soft cancel). See docs/TZ.md §6.2, §6.3.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, notFound, conflict, forbidden, err, diff } from "@/server/http";
import { UpdateAppointmentSchema } from "@/server/schemas/appointment";
import {
  applyTime,
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { tashkentComponents } from "@/lib/booking-validation";
import { initials } from "@/lib/format";
import { applyWaitingIntake } from "@/server/appointments/intake";
import { runCompletionEffects } from "@/server/appointments/completion-effects";
import { runNoShowEffects } from "@/server/appointments/no-show";
import {
  recomputeAppointmentPrice,
  recomputeCaseAppointments,
} from "@/server/pricing/recompute-appointment-price";
import { fireTrigger } from "@/server/notifications/triggers";
import { refreshPatientVisitStats } from "@/server/patient/last-contacted";
import { refreshPatientSegment } from "@/server/patient/segments";
import { cancelAppointment } from "@/server/appointments/cancel";
import {
  AnotherVisitInProgressError,
  orActiveVisitConflict,
  runStartVisitTx,
  type TxClient,
} from "@/server/appointments/active-visit";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { isSlotOverlapViolation } from "@/server/appointments/overlap-violation";
import { newCorrelationId } from "@/server/realtime/outbox";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { numberedSiblingsWhere } from "@/lib/cases/case-visits";
import { recordPatientView } from "@/server/audit/patient-view";
import {
  actionsFor,
  canTransitionAt,
  isOnClinicDay,
  requiresVisitDay,
  revertTargetFor,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  canRoleAdvanceTo,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import { sendCallNotice } from "@/server/telegram/call-notice";
import { clientIpForAudit } from "@/lib/client-ip";
import { storageKeyFromUrl } from "@/lib/storage-ref";
import {
  ensureSignedStateOnRecord,
  revisionContentOf,
} from "@/server/visit-notes/revisions";
import { findUnsignedDraft } from "@/server/visit-notes/unsigned-draft";
import { recordRescheduleOutcome } from "@/server/actions/risk-outcome";
import {
  REVIVED_BOOKING_RESET,
  cancelledByPatient,
  isSlotClash,
  restoredStatusOf,
  revivesBooking,
} from "@/server/appointments/revert-restore";
import { checkInResetOnMove } from "@/lib/appointments/self-check-in";
import { canEditPrice, priceFieldsIn } from "@/lib/appointments/price-edit";
import {
  loadDoctorMoveTerms,
  loadDoctorServiceTerms,
} from "@/server/doctors/service-terms";
import {
  durationAfterDoctorChange,
  linePricesForDoctor,
} from "@/lib/doctor-service-terms";

/** Who may record a risk-today outcome: the roles of its endpoint (and
 *  SUPER_ADMIN, whom the handler lets through every role list). */
const RISK_OUTCOME_ROLES: ReadonlySet<string> = new Set([
  "ADMIN",
  "RECEPTIONIST",
  "SUPER_ADMIN",
]);

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** The PATCH write lost the slot to a concurrent booking (23P01). */
const SLOT_TAKEN = Symbol("slot_taken");

/**
 * The 409 every start path answers when the doctor already has a visit on
 * the table. My Day reads `activeAppointmentId` to offer «close it and
 * switch».
 */
function anotherVisitConflict(e: AnotherVisitInProgressError): Response {
  return conflict("another_visit_in_progress", {
    activeAppointmentId: e.activeAppointmentId,
    activePatientName: e.activePatientName,
  });
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const row = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            userId: true,
            color: true,
            photoUrl: true,
          },
        },
        cabinet: true,
        primaryService: true,
        services: { include: { service: true } },
        payments: true,
        medicalCase: {
          select: {
            id: true,
            title: true,
            status: true,
            primaryDoctorId: true,
            openedAt: true,
          },
        },
      },
    });
    if (!row) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      row.doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    // Compute visit ordinal within the case using a single query. Ordering by
    // (date asc, createdAt asc) keeps ties stable across reschedules — the
    // appointment's slot in the case timeline doesn't shuffle when an unrelated
    // sibling moves around. Only one query regardless of case size, so the
    // overhead is constant; null-safe when the appointment isn't in any case.
    // Cancelled siblings and no-shows never happened and take no number
    // (audit PT-16, the pricing engine's rule): after a cancelled first
    // booking, the visit that took place is «Первичный», not «2-й». The
    // appointment itself always counts, so a cancelled one still reads
    // where it stood.
    let visitNumberInCase: number | null = null;
    let totalVisitsInCase: number | null = null;
    if (row.medicalCaseId) {
      const siblings = await prisma.appointment.findMany({
        where: numberedSiblingsWhere(row.medicalCaseId, row.id),
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      totalVisitsInCase = siblings.length;
      const idx = siblings.findIndex((s) => s.id === row.id);
      visitNumberInCase = idx >= 0 ? idx + 1 : null;
    }

    // Phase 17 Wave 1 — opening the appointment drawer is PHI access; the
    // associated patient is in `row.patientId`. Throttled inside the helper.
    if (ctx.kind === "TENANT") {
      void recordPatientView({
        prisma,
        clinicId: ctx.clinicId,
        viewerUserId: ctx.userId,
        viewerRole: ctx.role,
        patientId: row.patientId,
        context: "appointment.drawer",
        contextRef: row.id,
        ip: clientIpForAudit(request),
        userAgent: request.headers.get("user-agent"),
      });
    }

    return ok({ ...row, visitNumberInCase, totalVisitsInCase });
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: UpdateAppointmentSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true } } },
    });
    if (!before) return notFound();

    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      before.doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    // Audit AP-03 — overriding the price (final price, discount, a line's
    // price) is the front desk's and the administrator's call; a doctor's
    // own PATCH could zero his visit's bill. The patient and the case are
    // refused by the schema (400); a queue move without a status too.
    const priceFields = priceFieldsIn(body);
    if (priceFields.length > 0 && ctx.kind === "TENANT" && !canEditPrice(ctx.role)) {
      return err("Forbidden", 403, {
        reason: "role_cannot_edit_price",
        fields: priceFields,
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Doctor-initiated revert path. `?revert=true` bypasses the forward
    // TRANSITIONS guard and uses the REVERTS map instead. Only doctors can
    // revert, and only on their own appointments — same predicate as the
    // forbidden() check above, plus an explicit role check here for callers
    // running under SUPER_ADMIN or other privileged contexts.
    // ──────────────────────────────────────────────────────────────────────
    const revertRequested =
      new URL(request.url).searchParams.get("revert") === "true";
    if (revertRequested) {
      if (ctx.kind !== "TENANT" || ctx.role !== "DOCTOR") {
        return forbidden();
      }
      if (before.doctor.userId !== ctx.userId) {
        return forbidden();
      }
      const fromStatus = before.status as AppointmentStatus;
      const expected = revertTargetFor(fromStatus);
      if (!expected) {
        return conflict("not_revertable", { from: fromStatus });
      }
      if (body.status !== expected) {
        return conflict("revert_target_mismatch", {
          from: fromStatus,
          expected,
          got: body.status,
        });
      }
      // AP-11 — undoing a cancellation or a no-show puts the visit back on
      // the calendar (see revert-restore). Not a visit the patient cancelled
      // himself: bringing it back is a new booking made with him. And not
      // over someone else's booking: the freed slot may be taken, which used
      // to surface as a 500 from the overlap constraint. A walk-in holds no
      // slot (the constraints skip it too).
      const revives = revivesBooking(fromStatus);
      if (revives) {
        if (
          fromStatus === "CANCELLED" &&
          (await cancelledByPatient(id, ctx.clinicId))
        ) {
          return conflict("cancelled_by_patient");
        }
        if (before.channel !== "WALKIN") {
          const c = await detectConflicts({
            doctorId: before.doctorId,
            cabinetId: before.cabinetId,
            startAt: before.date,
            endAt: before.endDate,
            excludeId: id,
            // The slot keeps its time: a revert is not a move into the past.
            currentStartAt: before.date,
          });
          if (!c.ok && isSlotClash(c.reason)) {
            return conflict(c.reason, c.until ? { until: c.until } : undefined);
          }
        }
      }
      // Reverting COMPLETED → IN_PROGRESS re-opens the visit, so it must obey
      // the same single-active-visit rule as the forward "Начать приём" path —
      // otherwise a doctor can complete one patient, start the next, then
      // revert the first and end up with two visits live at once. The check
      // runs inside the revert's own transaction (Q-13, `runStartVisitTx`).
      const clinicId = ctx.clinicId;
      const runRevertTx = <T,>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
        expected === "IN_PROGRESS"
          ? runStartVisitTx(
              { clinicId, doctorId: before.doctorId, appointmentId: id },
              fn,
            )
          : prisma.$transaction(fn);
      // Build a tight data set — revert only flips status and clears the
      // matching timestamp. We deliberately do NOT touch endDate / durationMin
      // (the COMPLETED branch may have shrunk them; restoring is best-effort
      // and we don't store the original anyway — re-completing will reshrink).
      // A revived booking comes back as it was before it was dropped:
      // confirmed if the patient had confirmed it (BOOKED with a confirmedAt
      // was a state no other path writes), and out of the live queue.
      const target = revives ? restoredStatusOf(before) : expected;
      const revertData: Record<string, unknown> = {
        status: target,
        queueStatus: target,
        ...(revives ? REVIVED_BOOKING_RESET : {}),
      };
      if (fromStatus === "IN_PROGRESS") {
        revertData.startedAt = null;
      }
      if (fromStatus === "COMPLETED") {
        revertData.completedAt = null;
      }
      if (fromStatus === "CANCELLED") {
        revertData.cancelledAt = null;
        revertData.cancelReason = null;
      }

      const revertOutcome = await orActiveVisitConflict(runRevertTx(async (tx) => {
        const row = await tx.appointment.update({
          where: { id },
          data: revertData as never,
        });

        // Un-signing the conclusion is part of re-opening the visit. Without
        // it the doctor lands on a live visit holding a FINALIZED note: the
        // editor stays read-only and «Завершить приём» answers
        // `alreadyFinalized` forever — the visit can never be closed again.
        //
        // documentNumber is deliberately KEPT: the finalize path reuses it
        // (`note.documentNumber ?? allocate…`), so the re-signed conclusion
        // carries the same number the patient may already hold on paper.
        // PatientDiagnosis rows are kept too — the diagnosis was genuinely
        // made, and a re-finalize updates the same row.
        if (fromStatus === "COMPLETED") {
          const signedNote = await tx.visitNote.findFirst({
            where: { appointmentId: id, status: "FINALIZED" },
            include: { visitPrescriptions: { orderBy: { sortOrder: "asc" } } },
          });
          if (signedNote) {
            await tx.visitNote.update({
              where: { id: signedNote.id },
              data: {
                status: "DRAFT",
                finalizedAt: null,
                // The handout is composed from what is signed (audit VW-02);
                // a reopened note has nothing signed, and the next signature
                // composes it afresh. Keeping it let a re-sign carry the old
                // text into the patient's PDF and Mini App.
                patientHandoutMarkdown: null,
                // `firstFinalizedAt` is deliberately NOT cleared — it is the
                // immutability clock, and reopening it would let a document
                // signed weeks ago be rewritten destructively.
                //
                // Back to the medication reconciler: on the next finalize it
                // re-bridges the (possibly edited) prescriptions instead of
                // leaving the patient's live courses frozen at the old set.
                medicationsBridgedAt: null,
                // The patient may already hold the rendered PDF (and its QR
                // resolves to it). Marking the handout stale is what puts the
                // note back into the re-render sweep after the next
                // signature — without it the sweep skips the note forever
                // (its Document row already exists) and the patient keeps a
                // conclusion that contradicts the corrected one in the CRM.
                handoutStaleAt: new Date(),
              },
            });
            // G1-01 — un-signing does not erase what was signed: when no
            // revision holds the signed state yet (signed before revisions
            // existed), it is recorded now, before the edits that follow.
            await ensureSignedStateOnRecord(tx, {
              clinicId: signedNote.clinicId,
              visitNoteId: signedNote.id,
              content: revisionContentOf(
                signedNote,
                signedNote.visitPrescriptions,
              ),
              issuedPdfKey: async () =>
                storageKeyFromUrl(
                  (
                    await tx.document.findUnique({
                      where: { visitNoteId: signedNote.id },
                      select: { fileUrl: true },
                    })
                  )?.fileUrl,
                ),
            });
            // Courses bridged from this note keep reminding the patient
            // while the visit is reopened — and a doctor reverting to REMOVE
            // a drug (an adverse reaction is the realistic reason) would
            // otherwise keep nagging them to take it. Reminders off now; the
            // reconciler restores or cancels each course on re-signature.
            await tx.prescription.updateMany({
              where: { visitNoteId: signedNote.id, status: "ACTIVE" },
              data: { remindersEnabled: false },
            });
          }
        }
        // Re-pricing siblings is needed when un-killing a visit (CANCELLED
        // or NO_SHOW → BOOKED) because the case timeline now has a new
        // active sibling. SKIPPED → WAITING does not affect repricing
        // (SKIPPED already counts as active for free-repeat purposes).
        if (revives && row.medicalCaseId) {
          await recomputeCaseAppointments(tx, row.medicalCaseId);
        }
        const actorUserId = ctx.userId || null;
        await emitAppointmentChangeViaOutbox({
          tx,
          kind: "statusChanged",
          before,
          after: row,
          clinicId: ctx.clinicId,
          actorId: actorUserId,
          actorRole: "DOCTOR",
          actorLabel: actorUserId ? `user:${actorUserId}` : "user:anonymous",
          surface: "DOCTOR_CABINET",
          correlationId: newCorrelationId(),
          alsoQueueUpdate: row.queueStatus !== before.queueStatus,
        });
        return row;
      })).catch((e: unknown): typeof SLOT_TAKEN => {
        // AP-11 — a booking that took the slot after the check above: the
        // overlap constraint has the last word, and it is a busy doctor.
        if (isSlotOverlapViolation(e)) return SLOT_TAKEN;
        throw e;
      });
      if (revertOutcome === SLOT_TAKEN) {
        return conflict("doctor_busy");
      }
      if (revertOutcome instanceof AnotherVisitInProgressError) {
        return anotherVisitConflict(revertOutcome);
      }
      const revertedRow = revertOutcome;

      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_STATUS_REVERTED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          from: fromStatus,
          to: target,
          doctorUserId: ctx.userId,
          originalStartedAt: before.startedAt,
          originalCompletedAt: before.completedAt,
          originalCancelledAt: before.cancelledAt,
          // Un-signing a conclusion is a medico-legal event of its own.
          unsignedVisitNote: fromStatus === "COMPLETED",
        },
      });

      // The completion bumped the denormalised visit stats; un-completing
      // must bring them back or the patient reads as having one visit more
      // than they had — permanently, if the visit is never re-completed.
      if (fromStatus === "COMPLETED") {
        await refreshPatientVisitStats(before.patientId);
      }
      // The segment follows both (PT-15): an un-completed visit takes back
      // the visit it counted, and a no-show or a cancellation undone gives
      // the patient his booking back, which takes him off «Остывают».
      // Logs and swallows its own failures.
      if (
        fromStatus === "COMPLETED" ||
        fromStatus === "NO_SHOW" ||
        fromStatus === "CANCELLED"
      ) {
        await refreshPatientSegment(before.patientId);
      }
      // AP-11 — the cancellation told the patient and cancelled every queued
      // reminder. The revived visit tells him it is back (the clinic's
      // «запись восстановлена» message, off until the clinic switches it on)
      // and rebuilds the reminder cascade for the time still ahead.
      if (revives) {
        fireTrigger({ kind: "appointment.restored", appointmentId: id });
      }

      return ok(revertedRow);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Doctor-initiated "Вызвать пациента" — sets calledAt = now(), bumps
    // BOOKED/CONFIRMED → WAITING when applicable, fires the patient-facing Telegram
    // notification ("Проходите в кабинет N"). The call is distinct from the
    // status transition: the appointment is NOT IN_PROGRESS yet — that
    // happens when the doctor presses "Начать приём" after the patient
    // walks in. Repeated calls within the same WAITING window refresh
    // calledAt and re-fire the notification (handy when a patient doesn't
    // come back in 2-3 minutes).
    // ──────────────────────────────────────────────────────────────────────
    const callRequested =
      new URL(request.url).searchParams.get("call") === "true";
    if (callRequested) {
      if (ctx.kind !== "TENANT" || ctx.role !== "DOCTOR") {
        return forbidden();
      }
      if (before.doctor.userId !== ctx.userId) {
        return forbidden();
      }
      const fromStatus = before.status as AppointmentStatus;
      // The specific reason goes in the primary slot — passing it inside
      // `extra` used to clobber the generic "invalid_transition" and the
      // client mapper (messageFor) knew neither string, so the doctor only
      // ever saw a generic «не удалось вызвать» toast.
      if (
        fromStatus === "COMPLETED" ||
        fromStatus === "CANCELLED" ||
        fromStatus === "NO_SHOW"
      ) {
        return conflict("cannot_call_terminal", { from: fromStatus });
      }
      if (fromStatus === "IN_PROGRESS") {
        return conflict("already_in_progress", { from: fromStatus });
      }
      // Q-05 — the call starts the visit and pushes «Вас вызывают» to the
      // patient's phone: only on the visit's own clinic day, like reception's.
      if (!isOnClinicDay(before.date)) {
        return conflict("not_today", { from: fromStatus });
      }

      // One patient at a time: calling a patient in now *starts* their visit
      // (calledAt + IN_PROGRESS in a single click), so it must obey the same
      // single-active-visit rule as the forward path — a doctor can't pull a
      // second patient onto the table until the current one is fully closed.
      // Checked inside the write's transaction below (Q-13).

      // «Вызвать» === «Начать приём»: stamp calledAt (still fires the patient
      // Telegram "вас вызывают") and move straight into IN_PROGRESS so the
      // doctor doesn't need a separate start click. Both status columns move
      // together — reception reads `queueStatus`, the doctor surface `status`.
      const calledAt = new Date();
      const callData: Record<string, unknown> = {
        calledAt,
        status: "IN_PROGRESS",
        queueStatus: "IN_PROGRESS",
        startedAt: calledAt,
      };

      const callCorrelationId = newCorrelationId();
      const callOutcome = await orActiveVisitConflict(runStartVisitTx(
        { clinicId: ctx.clinicId, doctorId: before.doctorId, appointmentId: id },
        async (tx) => {
          const row = await tx.appointment.update({
            where: { id },
            data: callData as never,
            select: {
              id: true,
              status: true,
              queueStatus: true,
              queueOrder: true,
              ticketSeq: true,
              calledAt: true,
              date: true,
              doctorId: true,
              patientId: true,
              cabinetId: true,
              patient: {
                select: { fullName: true, telegramId: true, preferredLang: true },
              },
              doctor: {
                select: {
                  nameRu: true,
                  nameUz: true,
                  ticketPrefix: true,
                  cabinet: { select: { number: true } },
                },
              },
              clinic: {
                select: {
                  id: true,
                  slug: true,
                  tgBotToken: true,
                  tgBotUsername: true,
                },
              },
            },
          });
          // The call always flips status into IN_PROGRESS now, so always emit
          // the `statusChanged` event (drives the queue board + doctor surface).
          const actorUserId = ctx.userId || null;
          await emitAppointmentChangeViaOutbox({
            tx,
            kind: "statusChanged",
            before,
            after: row,
            clinicId: ctx.clinicId,
            actorId: actorUserId,
            actorRole: "DOCTOR",
            actorLabel: actorUserId ? `user:${actorUserId}` : "user:anonymous",
            surface: "DOCTOR_CABINET",
            correlationId: callCorrelationId,
            alsoQueueUpdate: row.queueStatus !== before.queueStatus,
          });
          return row;
        },
      ));
      if (callOutcome instanceof AnotherVisitInProgressError) {
        return anotherVisitConflict(callOutcome);
      }
      const updatedRow = callOutcome;

      // Ephemeral board signal — drives the public waiting-room board's
      // "now calling" banner + chime. Fire-and-forget (no outbox/replay) so a
      // reconnecting TV never re-chimes a stale call; the durable
      // statusChanged above already covers state reconciliation.
      publishEventSafe(ctx.clinicId, {
        type: "queue.called",
        payload: {
          appointmentId: updatedRow.id,
          doctorId: updatedRow.doctorId,
          queueOrder: updatedRow.queueOrder,
          // Null for a booking started without check-in — no fake "X-000".
          ticketNumber: ticketNumberFor(
            updatedRow.doctor,
            updatedRow.ticketSeq ?? updatedRow.queueOrder,
          ),
          // Initials only — same PHI-safe reduction the board route serves.
          patientName: initials(updatedRow.patient.fullName) || undefined,
          cabinetNumber: updatedRow.doctor.cabinet?.number ?? null,
          calledAt: updatedRow.calledAt?.toISOString(),
          // The board announces the call in the patient's language (UX-06).
          lang: updatedRow.patient.preferredLang === "UZ" ? "uz" : "ru",
        },
      });

      // Q-18 — the same module as the reception call (`sendCallNotice`), so
      // the push is in the patient's language: this branch built its own
      // Russian text and an Uzbek patient called by the doctor read «Вас
      // вызывают!» while one called by reception read «Sizni chaqirishmoqda!».
      // It swallows its own errors (a committed call never 500s on Telegram).
      const notificationSent = await sendCallNotice({
        clinic: updatedRow.clinic,
        telegramId: updatedRow.patient.telegramId,
        cabinetNumber: updatedRow.doctor.cabinet?.number ?? null,
        doctorName: updatedRow.doctor.nameRu,
        doctorNameUz: updatedRow.doctor.nameUz,
        lang: updatedRow.patient.preferredLang,
        logTag: "appointments/call",
      });

      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_CALLED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          doctorUserId: ctx.userId,
          previousStatus: fromStatus,
          startedVisit: true,
          notificationSent,
          correlationId: callCorrelationId,
        },
      });

      // The clinic join carries the bot token for the push above; it must
      // never reach the browser (the reception call strips it the same way).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-omit of the secret-bearing join
      const { clinic: _clinic, ...callBody } = updatedRow;
      return ok(callBody);
    }

    // AP-06 — a live-queue ticket (WALKIN) keeps its channel. The schema only
    // refused a flip INTO WALKIN; a flip out of it moved the row onto the
    // schedule axis: the patient vanished from the doctor's queue and the TV,
    // or the row met a booking of the same doctor under the EXCLUDE
    // constraint (`channel <> 'WALKIN'`) and the desk got a 500.
    if (before.channel === "WALKIN" && body.channel !== undefined) {
      return conflict("walkin_locked", { field: "channel" });
    }

    if (body.status !== undefined) {
      const check = canTransitionAt(
        before.status as AppointmentStatus,
        body.status as AppointmentStatus,
        before.date,
      );
      if (!check.ok) {
        return conflict(check.reason, {
          from: before.status,
          to: body.status,
        });
      }
      // Role-ownership: doctors drive IN_PROGRESS / COMPLETED. Mirrors
      // queue-status route + the lifecycle UI; same predicate, same outcome.
      if (ctx.kind === "TENANT") {
        const role = ctx.role as LifecycleRole;
        if (!canRoleAdvanceTo(role, body.status as AppointmentStatus)) {
          return err("Forbidden", 403, {
            reason: "role_cannot_advance_to",
            target: body.status,
            role,
          });
        }
      }

      // DC-01 — the doctor closes his visit by SIGNING it (finalize, which
      // also completes the visit). Completing it here around a draft with
      // content left the conclusion unsigned for good: no number, no
      // diagnosis on the chart, nothing sent to the patient. Refuse and name
      // the note; My Day then offers to sign it. Reception staff may still
      // close a visit (the doctor signs later from «Заключения»).
      if (
        body.status === "COMPLETED" &&
        before.status !== "COMPLETED" &&
        ctx.kind === "TENANT" &&
        ctx.role === "DOCTOR"
      ) {
        const unsigned = await findUnsignedDraft(id);
        if (unsigned) return conflict("visit_note_unsigned", unsigned);
      }
    }

    // Single active visit per doctor — block starting a second visit while
    // one is already IN_PROGRESS (any surface / stale tab / scripted call).
    // The check runs inside the update's own Serializable transaction below
    // (Q-13): a read before a separate write let two starts both pass.
    const startsVisit =
      body.status === "IN_PROGRESS" &&
      before.status !== "IN_PROGRESS" &&
      ctx.kind === "TENANT";

    // If any time/doctor change, re-run conflict detection. Cabinet is no
    // longer client-controlled (Phase 11 binding) — when doctorId changes we
    // re-derive cabinet from the new doctor, otherwise keep before.cabinetId.
    const timeChanged =
      body.date !== undefined ||
      body.time !== undefined ||
      body.durationMin !== undefined ||
      body.doctorId !== undefined;

    let startAt = before.date;
    let endAt = before.endDate;
    let nextCabinetId: string | null = before.cabinetId;
    if (body.doctorId !== undefined && body.doctorId !== before.doctorId) {
      const newDoc = await prisma.doctor.findUnique({
        where: { id: body.doctorId },
        select: { cabinetId: true, isActive: true },
      });
      if (!newDoc || !newDoc.isActive) {
        return conflict("doctor_not_found");
      }
      nextCabinetId = newDoc.cabinetId;
    }
    // Set when the visit moves to another doctor (review of DR-02, below).
    let doctorLinePrices: { serviceId: string; priceSnap: number }[] = [];
    let doctorDurationMin: number | null = null;

    if (timeChanged) {
      const date = body.date ?? before.date;
      const time = body.time === undefined ? before.time : body.time;
      const dur = body.durationMin ?? before.durationMin;
      startAt = applyTime(date, time);
      endAt = computeEndDate(startAt, dur);
      const doctorId = body.doctorId ?? before.doctorId;
      // Only an actual change of the slot counts: a stale client resending
      // the same values is not a move.
      const slotMoves =
        startAt.getTime() !== before.date.getTime() ||
        endAt.getTime() !== before.endDate.getTime() ||
        doctorId !== before.doctorId;
      if (slotMoves) {
        // AP-06 — a walk-in is served by queue order, not by a slot, and
        // its ticket is the doctor's. Moving it to another day un-arrived it
        // into a CONFIRMED walk-in no reception lane shows.
        if (before.channel === "WALKIN") {
          return conflict("walkin_locked", { field: "slot" });
        }
        // AP-10 — only a visit that can still be rescheduled moves. The
        // calendar used to drag a completed visit to another doctor (its
        // revenue and commission went with it, the conclusion stayed) and a
        // cancelled one told the patient «приём перенесён».
        if (!actionsFor(before.status as AppointmentStatus).canReschedule) {
          return conflict("invalid_transition", {
            from: before.status,
            action: "reschedule",
          });
        }
      }
      // Review of DR-02: price and length depend on the doctor, and the
      // calendar's drag to another doctor's column sends only date, time and
      // doctorId. The visit kept the leaving doctor's line prices (the
      // reprice below rebuilds the total from them) and his slot length, so
      // his 300 000 consult moved to a 200 000 colleague stayed at 300 000.
      // It now takes the new doctor's terms, as booking him would have, and
      // the overlap check below runs on the block it will really occupy. A
      // PATCH that also sends `services` prices its new lines with the new
      // doctor already and owns the length, like `durationMin` does.
      if (doctorId !== before.doctorId && body.services === undefined) {
        const move = await loadDoctorMoveTerms(prisma, {
          appointmentId: id,
          fromDoctorId: before.doctorId,
          toDoctorId: doctorId,
        });
        // A paid visit keeps its price on a move (the pricing engine's
        // lock), so its lines stay too: lines that disagree with the total
        // would resurface on the next explicit services edit.
        if (!move.paid) {
          doctorLinePrices = linePricesForDoctor(move.lines, move.to);
        }
        if (body.durationMin === undefined) {
          doctorDurationMin = durationAfterDoctorChange({
            durationMin: before.durationMin,
            serviceIds: move.serviceIds,
            from: move.from,
            to: move.to,
          });
          endAt = computeEndDate(startAt, doctorDurationMin);
        }
      }
      // Two-lanes (TZ I4): a walk-in never reaches here with a move (refused
      // above), and its date window is technical, so it skips conflict
      // detection; bookings keep the full check.
      if (before.channel !== "WALKIN") {
        const c = await detectConflicts({
          doctorId,
          cabinetId: nextCabinetId,
          startAt,
          endAt,
          excludeId: id,
          currentStartAt: before.date,
        });
        if (!c.ok) {
          return conflict(c.reason, c.until ? { until: c.until } : undefined);
        }
      }
    }

    const data: Record<string, unknown> = { ...body };
    // A request flag, not a column (read after the commit below).
    delete data.riskOutcome;
    // Keep the queue column in lockstep with status — the reception board
    // reads `queueStatus` while the doctor's my-day mutation only sends
    // `status`. The queue-status route already writes both; without this
    // mirror the «Кабинеты и врачи» list never sees doctor-driven flips.
    if (body.status !== undefined && body.queueStatus === undefined) {
      data.queueStatus = body.status;
    }
    if (timeChanged) {
      data.date = startAt;
      data.endDate = endAt;
    }
    if (body.doctorId !== undefined && body.doctorId !== before.doctorId) {
      data.cabinetId = nextCabinetId;
    }
    if (doctorDurationMin !== null && doctorDurationMin !== before.durationMin) {
      data.durationMin = doctorDurationMin;
    }

    // Rescheduling an arrived (WAITING) row onto a different Tashkent day
    // un-arrives it: the patient isn't in today's waiting room anymore, so
    // status returns to CONFIRMED and the FIFO anchor (queuedAt) clears.
    // ticketSeq/queueOrder stay frozen (two-lanes I5) — if they come back the
    // same day their printed ticket is still theirs. Skipped when the caller
    // drives status explicitly in the same PATCH: an explicit transition wins.
    const dayMoved =
      timeChanged &&
      tashkentComponents(before.date).date !== tashkentComponents(startAt).date;
    const unarriveOnDayMove =
      dayMoved &&
      before.queueStatus === "WAITING" &&
      body.status === undefined &&
      body.queueStatus === undefined;
    if (unarriveOnDayMove) {
      data.status = "CONFIRMED";
      data.queueStatus = "CONFIRMED";
      data.queuedAt = null;
    }
    // Review of G3-01: a Mini App «Я на месте» belongs to the day it was
    // made. The Mini App refuses to move a checked-in visit, so this is the
    // path such a visit moves by; moved to another clinic day it drops the
    // stamp. Otherwise the new day showed «Отметился в приложении», the
    // sweep never marked a real no-show, and the patient's tap on the new
    // day was swallowed as a repeat.
    if (timeChanged) Object.assign(data, checkInResetOnMove(before.date, startAt));

    // Q-05 — arrival and the call only on the visit's own clinic day, judged
    // on the slot as it will be after this PATCH. `canTransitionAt` above
    // already refused a status flip on another day; this also covers a raw
    // `queueStatus` write and a PATCH that moves the visit off today while
    // flipping it.
    const entersBuilding =
      (body.status !== undefined &&
        requiresVisitDay(
          before.status as AppointmentStatus,
          body.status as AppointmentStatus,
        )) ||
      (body.queueStatus !== undefined &&
        requiresVisitDay(
          before.queueStatus as AppointmentStatus,
          body.queueStatus as AppointmentStatus,
        ));
    if (entersBuilding && !isOnClinicDay(startAt)) {
      return conflict("not_today", {
        from: before.status,
        to: body.status ?? body.queueStatus,
      });
    }

    // When the discount changes and the caller hasn't pinned `priceFinal`
    // explicitly in the same PATCH, recompute priceFinal from the stored
    // priceBase snapshot. Without this, doctor commission and patient LTV
    // (both derived from priceFinal) drift after retroactive discount edits.
    const discountChanged =
      body.discountPct !== undefined || body.discountAmount !== undefined;
    if (discountChanged && body.priceFinal === undefined && before.priceBase !== null) {
      const pct = body.discountPct ?? before.discountPct ?? 0;
      const amt = body.discountAmount ?? before.discountAmount ?? 0;
      data.priceFinal = Math.max(
        0,
        before.priceBase - amt - Math.round((pct * before.priceBase) / 100),
      );
    }
    if (body.status === "CANCELLED" && !before.cancelledAt) {
      data.cancelledAt = new Date();
    }
    if (body.status === "COMPLETED" && !before.completedAt) {
      const now = new Date();
      data.completedAt = now;
      // Mirror the queue-status route: when the visit completes ahead of the
      // booked end, shrink the slot so the freed tail is bookable. Skip if
      // the caller is also moving the time in this same PATCH (timeChanged
      // path already recomputed endDate).
      if (!timeChanged) {
        const minEnd = new Date(before.date.getTime() + 5 * 60_000);
        const newEnd = now < minEnd ? minEnd : now;
        if (newEnd < before.endDate) {
          data.endDate = newEnd;
          data.durationMin = Math.max(
            5,
            Math.round((newEnd.getTime() - before.date.getTime()) / 60_000),
          );
        }
      }
    }
    if (body.status === "IN_PROGRESS" && !before.startedAt) {
      data.startedAt = new Date();
    }
    // WAITING flips through this generic PATCH mirror the queue-status route:
    // the row must claim its live-queue slot (see `applyWaitingIntake`, run
    // inside the tx below) and an IN_PROGRESS put-back clears the first-start
    // stamp so a later restart records fresh (?revert=true already does this).
    const movesToWaiting =
      body.status === "WAITING" || body.queueStatus === "WAITING";

    // Replace AppointmentService join rows if body.services provided.
    const services = body.services;
    delete (data as { services?: unknown }).services;

    // Recompute pricing whenever any input that could affect free-repeat
    // changed: date moved, the service set was edited, or visit-level
    // discount fields were touched. We call the helper inside the same tx so
    // the row never observes a transient inconsistent state. (The case
    // attachment changes only through attach/detach since AP-03, which
    // reprice on their own.)
    const recomputeNeeded =
      timeChanged ||
      services !== undefined ||
      body.serviceId !== undefined ||
      discountChanged;
    // A change to the visit's own services is staff asking to bill something
    // different, so it reprices even a visit that already has a payment: the
    // payments stay and the rest shows as owed (drawer, «Неоплаченные», the
    // payment dialog's prefill). A moved date or a case change is not such a
    // request and keeps a paid visit's price (recomputeAppointmentPrice).
    const servicesEdited =
      services !== undefined ||
      (body.serviceId !== undefined && body.serviceId !== before.serviceId);

    // Status transitions that "destroy" a visit (CANCELLED / NO_SHOW) must
    // re-evaluate every sibling in the same case: the row being killed can
    // no longer serve as the free-repeat anchor, so the next-earliest active
    // sibling becomes the new "first" and flips back to full price.
    const statusKillsVisit =
      body.status !== undefined &&
      (body.status === "CANCELLED" || body.status === "NO_SHOW") &&
      before.status !== body.status;
    // Date changes can flip the chronological order of the case, so every
    // sibling needs re-pricing too.
    const siblingRepriceNeeded =
      statusKillsVisit ||
      (timeChanged && before.medicalCaseId !== null);

    const patchCorrelationId = newCorrelationId();
    const runPatchTx = <T,>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
      startsVisit && ctx.kind === "TENANT"
        ? runStartVisitTx(
            { clinicId: ctx.clinicId, doctorId: before.doctorId, appointmentId: id },
            fn,
          )
        : prisma.$transaction(fn);
    const patchOutcome = await orActiveVisitConflict(runPatchTx(async (tx) => {
      // The new doctor's line prices go in before the reprice below reads
      // the lines (timeChanged is set by a doctor change).
      for (const line of doctorLinePrices) {
        await tx.appointmentService.updateMany({
          where: { appointmentId: id, serviceId: line.serviceId },
          data: { priceSnap: line.priceSnap },
        });
      }
      if (services !== undefined) {
        await tx.appointmentService.deleteMany({
          where: { appointmentId: id },
        });
        if (services.length > 0) {
          // Priced as the visit's doctor charges (audit DR-02), the same rule
          // the booking kernel snapshots at create time.
          const terms = await loadDoctorServiceTerms(tx, {
            doctorId: body.doctorId ?? before.doctorId,
            serviceIds: services.map((s) => s.serviceId),
          });
          const priceMap = new Map([...terms].map(([sid, t]) => [sid, t.price]));
          await tx.appointmentService.createMany({
            data: services.map((s) => ({
              appointmentId: id,
              serviceId: s.serviceId,
              priceSnap: s.priceOverride ?? priceMap.get(s.serviceId) ?? 0,
              quantity: s.quantity ?? 1,
            })) as never,
          });
        }
      }
      // Shared WAITING intake — queueOrder/ticketSeq allocation + queuedAt
      // stamp, merged into the same update so the row never observes a
      // WAITING state without its queue fields. This route's existing default
      // isolation is preserved (the queue-status route is the Serializable
      // hot path; this mirror mostly serves drawer/legacy flips).
      if (movesToWaiting) {
        Object.assign(
          data,
          await applyWaitingIntake(tx, { ...before, date: startAt }, new Date()),
        );
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: data as never,
      });
      // Reprice the row itself first (idempotent — recomputeCaseAppointments
      // below covers it again, but this keeps the audit-meta path simple).
      const recomputed = recomputeNeeded
        ? await recomputeAppointmentPrice(tx, id, { servicesEdited })
        : null;
      // Now repropagate to every sibling whose "first vs repeat" answer
      // could have flipped from this single change.
      if (siblingRepriceNeeded && updated.medicalCaseId) {
        await recomputeCaseAppointments(tx, updated.medicalCaseId);
      }
      // Re-read so the response reflects price fields that recompute may
      // have rewritten.
      const fresh =
        recomputed || siblingRepriceNeeded
          ? await tx.appointment.findUniqueOrThrow({ where: { id } })
          : updated;

      // Realtime fan-out via outbox so the appointment update + event row
      // commit atomically. Same routing as the legacy publishEventSafe path:
      //   - status flipped to CANCELLED → appointment.cancelled
      //   - any other status flip       → appointment.statusChanged
      //   - slot moved (time/doctor)    → appointment.moved
      //   - otherwise                   → appointment.updated
      if (ctx.kind === "TENANT") {
        const statusChanged =
          body.status !== undefined && body.status !== before.status;
        // An urgency bump re-sorts the waiting list without a status flip, so
        // the public TV board (which only refetches on queue.updated) needs the
        // follow-up envelope too.
        const priorityChanged =
          body.queuePriority !== undefined &&
          body.queuePriority !== before.queuePriority;
        const kind: "cancelled" | "statusChanged" | "moved" | "updated" =
          body.status === "CANCELLED"
            ? "cancelled"
            : statusChanged
              ? "statusChanged"
              : timeChanged
                ? "moved"
                : "updated";
        const actorRole = ctx.role === "DOCTOR" ? "DOCTOR" : "RECEPTIONIST";
        const actorUserId = ctx.userId || null;
        await emitAppointmentChangeViaOutbox({
          tx,
          kind,
          before,
          after: fresh,
          clinicId: ctx.clinicId,
          actorId: actorUserId,
          actorRole,
          actorLabel: actorUserId ? `user:${actorUserId}` : "user:anonymous",
          surface: ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM",
          correlationId: patchCorrelationId,
          // Queue snapshot shifts on any status flip or urgency bump — and on
          // the implicit day-move un-arrive, which changes queueStatus without
          // a body.status (boards must drop the row from today's list).
          alsoQueueUpdate: statusChanged || priorityChanged || unarriveOnDayMove,
        });
      }
      return { after: fresh, recomputed };
    })).catch((e: unknown): typeof SLOT_TAKEN => {
      // AP-06 — the EXCLUDE constraints are the last word on overlaps: a
      // booking that took the slot between `detectConflicts` and this write
      // is a busy doctor, not an internal error.
      if (isSlotOverlapViolation(e)) return SLOT_TAKEN;
      throw e;
    });
    if (patchOutcome === SLOT_TAKEN) {
      return conflict("doctor_busy");
    }
    if (patchOutcome instanceof AnotherVisitInProgressError) {
      return anotherVisitConflict(patchOutcome);
    }
    const txOut = patchOutcome;
    const after = txOut.after;

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "appointment.update",
      entityType: "Appointment",
      entityId: id,
      meta: d,
    });
    // Audit AP-03 — a hand-set price gets its own row, findable without
    // reading every update diff: who overrode what, from what, to what.
    if (priceFields.length > 0) {
      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_PRICE_OVERRIDE,
        entityType: "Appointment",
        entityId: id,
        meta: {
          fields: priceFields,
          before: {
            priceFinal: before.priceFinal,
            discountPct: before.discountPct,
            discountAmount: before.discountAmount,
          },
          after: {
            priceFinal: after.priceFinal,
            discountPct: after.discountPct,
            discountAmount: after.discountAmount,
          },
        },
      });
    }
    // Phase 11 — high-signal reschedule audit. Emit a dedicated
    // APPOINTMENT_RESCHEDULED row whenever any of the slot-defining fields
    // (start time, end time, doctor, cabinet) actually changed. Status-only
    // PATCHes don't qualify; no-op updates (same values) don't qualify
    // either. The same emit will fire for the calendar drag/drop endpoint
    // in Phase 12 since drag/drop dispatches PATCH here.
    const rescheduled =
      before.date.getTime() !== after.date.getTime() ||
      before.endDate.getTime() !== after.endDate.getTime() ||
      before.doctorId !== after.doctorId ||
      before.cabinetId !== after.cabinetId;
    if (rescheduled) {
      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_RESCHEDULED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          oldStartTime: before.date,
          newStartTime: after.date,
          oldEndTime: before.endDate,
          newEndTime: after.endDate,
          oldDoctorId: before.doctorId,
          newDoctorId: after.doctorId,
          oldCabinetId: before.cabinetId,
          newCabinetId: after.cabinetId,
        },
      });
    }
    // «Перенести» from the risk-today list is recorded by the saved move
    // (audit AC-10): the row's button only opens this drawer, which sends
    // `riskOutcome`. A drawer closed without saving never reaches here and
    // the row stays in the list. Only a move from that row counts: a
    // calendar drag or a doctor's PATCH is not a call to the patient, so it
    // closes no task as «Перенести» and marks nobody contacted. Same roles
    // as the risk-today outcome endpoint.
    let riskOutcomeRecorded = false;
    if (
      ctx.kind === "TENANT" &&
      body.riskOutcome === "RESCHEDULED" &&
      RISK_OUTCOME_ROLES.has(ctx.role) &&
      before.date.getTime() !== after.date.getTime()
    ) {
      const rec = await recordRescheduleOutcome({
        clinicId: after.clinicId,
        actorId: ctx.userId,
        before: { id, date: before.date, status: before.status },
      });
      if (rec.recorded) {
        riskOutcomeRecorded = true;
        for (const a of rec.actions) {
          await audit(request, {
            action: AUDIT_ACTION.ACTION_OUTCOME,
            entityType: "Action",
            entityId: a.id,
            meta: {
              type: a.type,
              appointmentId: id,
              outcome: "RESCHEDULED",
              oldStatus: a.oldStatus,
              newStatus: a.newStatus,
              createdForOutcome: a.id === rec.createdActionId,
              via: "appointment.reschedule",
            },
          });
        }
        if (rec.contactBumped) {
          await audit(request, {
            action: AUDIT_ACTION.PATIENT_CONTACT_MARKED,
            entityType: "Patient",
            entityId: rec.patientId,
            meta: {
              appointmentId: id,
              surface: "action-center.risk-today",
              outcome: "RESCHEDULED",
              at: new Date().toISOString(),
            },
          });
        }
      }
    }
    if (txOut.recomputed?.reason === "free_repeat") {
      await audit(request, {
        action: "appointment.free_repeat_applied",
        entityType: "Appointment",
        entityId: id,
        meta: {
          caseId: after.medicalCaseId,
          daysFromFirst: txOut.recomputed.daysFromFirst,
          savedAmount: txOut.recomputed.savedAmount,
          trace: txOut.recomputed.trace,
        },
      });
    }
    // Phase 3a notification triggers.
    if (body.status === "CANCELLED") {
      fireTrigger({ kind: "appointment.cancelled", appointmentId: id });
    } else if (body.status === "NO_SHOW") {
      // AP-04 — the effects every no-show path shares (message, risk
      // tasks); the case was already repriced in the transaction above
      // (`statusKillsVisit`). Only on the transition: a repeated NO_SHOW
      // PATCH is a no-op.
      if (before.status !== "NO_SHOW") {
        await runNoShowEffects({ clinicId: after.clinicId, appointmentId: id });
      }
    } else if (timeChanged) {
      // `timeChanged` is also true for a doctor-only swap (it re-runs conflict
      // detection), so compare the persisted starts: only an actual slot move
      // may claim "приём перенесён" to the patient and rebuild the cascade.
      // A same-time doctor change keeps the old top-up-only behaviour.
      const startMoved = after.date.getTime() !== before.date.getTime();
      fireTrigger({
        kind: startMoved ? "appointment.rescheduled" : "appointment.updated",
        appointmentId: id,
      });
    }

    // The completion's side effects ("Спасибо за визит", the referral
    // reward for a first visit, last contact, visit stats) run through the
    // one function every completion path shares (AP-07). Keyed on the
    // transition, not on `completedAt`: a revert clears the stamp, and a row
    // reaching COMPLETED is what closes the visit.
    if (body.status === "COMPLETED" && before.status !== "COMPLETED") {
      await runCompletionEffects({
        request,
        clinicId: after.clinicId,
        appointmentId: id,
        patientId: after.patientId,
        completedAt: after.completedAt ?? new Date(),
        thankPatient: true,
      });
    }

    // The drawer says «Исход записан» only when it was.
    return ok(riskOutcomeRecorded ? { ...after, riskOutcome: "RESCHEDULED" } : after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) return notFound();

    // DELETE means "soft-cancel". Reject if the appointment is already in a
    // terminal state — re-cancelling COMPLETED/CANCELLED/NO_SHOW is a UI bug.
    const transition = canTransitionAt(
      before.status as AppointmentStatus,
      "CANCELLED",
      before.date,
    );
    if (!transition.ok) {
      return conflict(transition.reason, {
        from: before.status,
        to: "CANCELLED",
      });
    }

    // Optional cancellation reason — DELETE bodies are unusual but supported.
    // Accept either { cancelReason } or { reason }; ignore parse errors.
    let cancelReason: string | null = null;
    try {
      const text = await request.text();
      if (text) {
        const parsed = JSON.parse(text) as {
          cancelReason?: unknown;
          reason?: unknown;
        };
        const raw =
          typeof parsed.cancelReason === "string"
            ? parsed.cancelReason
            : typeof parsed.reason === "string"
              ? parsed.reason
              : null;
        if (raw) cancelReason = raw.slice(0, 500).trim() || null;
      }
    } catch {
      // Body absent or not JSON — fine, cancelReason stays null.
    }

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return forbidden();
    const actorId = ctx.kind === "TENANT" ? ctx.userId || null : null;

    const result = await cancelAppointment({
      appointmentId: id,
      clinicId,
      actorId,
      reason: cancelReason,
      surface: "CRM",
    });
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      return conflict(result.reason, {
        from: before.status,
        to: "CANCELLED",
      });
    }
    return ok({ id, cancelled: true });
  }
);
