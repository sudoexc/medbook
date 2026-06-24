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
import {
  recomputeAppointmentPrice,
  recomputeCaseAppointments,
} from "@/server/pricing/recompute-appointment-price";
import { fireTrigger } from "@/server/notifications/triggers";
import { mintReferralRewardOnCompletion } from "@/server/patient-experience/referral-mint";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { cancelAppointment } from "@/server/appointments/cancel";
import { findOtherActiveVisit } from "@/server/appointments/active-visit";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { newCorrelationId } from "@/server/realtime/outbox";
import { recordPatientView } from "@/server/audit/patient-view";
import {
  canTransitionAt,
  revertTargetFor,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  canRoleAdvanceTo,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import { escapeHtml } from "@/lib/telegram";
import { sendMessage } from "@/server/telegram/send";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
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
    let visitNumberInCase: number | null = null;
    let totalVisitsInCase: number | null = null;
    if (row.medicalCaseId) {
      const siblings = await prisma.appointment.findMany({
        where: { medicalCaseId: row.medicalCaseId },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
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
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
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
      // Build a tight data set — revert only flips status and clears the
      // matching timestamp. We deliberately do NOT touch endDate / durationMin
      // (the COMPLETED branch may have shrunk them; restoring is best-effort
      // and we don't store the original anyway — re-completing will reshrink).
      const revertData: Record<string, unknown> = {
        status: expected,
        queueStatus: expected,
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

      const revertedRow = await prisma.$transaction(async (tx) => {
        const row = await tx.appointment.update({
          where: { id },
          data: revertData as never,
        });
        // Re-pricing siblings is needed when un-killing a visit (CANCELLED
        // or NO_SHOW → BOOKED) because the case timeline now has a new
        // active sibling. SKIPPED → WAITING does not affect repricing
        // (SKIPPED already counts as active for free-repeat purposes).
        const unkill =
          fromStatus === "CANCELLED" || fromStatus === "NO_SHOW";
        if (unkill && row.medicalCaseId) {
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
      });

      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_STATUS_REVERTED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          from: fromStatus,
          to: expected,
          doctorUserId: ctx.userId,
          originalStartedAt: before.startedAt,
          originalCompletedAt: before.completedAt,
          originalCancelledAt: before.cancelledAt,
        },
      });

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
      if (
        fromStatus === "COMPLETED" ||
        fromStatus === "CANCELLED" ||
        fromStatus === "NO_SHOW"
      ) {
        return conflict("invalid_transition", {
          from: fromStatus,
          reason: "cannot_call_terminal",
        });
      }
      if (fromStatus === "IN_PROGRESS") {
        return conflict("invalid_transition", {
          from: fromStatus,
          reason: "already_in_progress",
        });
      }

      const callData: Record<string, unknown> = {
        calledAt: new Date(),
      };
      // CRM bookings are auto-CONFIRMED at creation, so the call must bump
      // CONFIRMED too — otherwise the default booking never reaches WAITING
      // when the doctor drives the flow. Both columns move together: the
      // reception board reads `queueStatus`, the doctor surface reads `status`.
      const bumpToWaiting =
        fromStatus === "BOOKED" || fromStatus === "CONFIRMED";
      if (bumpToWaiting) {
        callData.status = "WAITING";
        callData.queueStatus = "WAITING";
      }

      const callCorrelationId = newCorrelationId();
      const updatedRow = await prisma.$transaction(async (tx) => {
        const row = await tx.appointment.update({
          where: { id },
          data: callData as never,
          select: {
            id: true,
            status: true,
            queueStatus: true,
            calledAt: true,
            date: true,
            doctorId: true,
            patientId: true,
            cabinetId: true,
            patient: { select: { fullName: true, telegramId: true } },
            doctor: {
              select: {
                nameRu: true,
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
        // Only emit `statusChanged` when the bump actually flipped status —
        // otherwise this is just a `calledAt` timestamp refresh and the
        // queue lane is unchanged.
        if (bumpToWaiting) {
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
        }
        return row;
      });

      let notificationSent = false;
      if (updatedRow.patient.telegramId) {
        const cabinetLine = updatedRow.doctor.cabinet?.number
          ? `Кабинет ${escapeHtml(updatedRow.doctor.cabinet.number)}`
          : "Подойдите к врачу";
        const text = `📢 <b>Вас вызывают!</b>\n\n${cabinetLine}\nВрач: ${escapeHtml(updatedRow.doctor.nameRu)}`;
        await sendMessage(updatedRow.clinic, updatedRow.patient.telegramId, text, {
          parse_mode: "HTML",
        })
          .then(() => {
            notificationSent = true;
          })
          .catch((err) => {
            console.error("[appointments/call] telegram", err);
          });
      }

      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_CALLED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          doctorUserId: ctx.userId,
          previousStatus: fromStatus,
          statusBumpedToWaiting: bumpToWaiting,
          notificationSent,
          correlationId: callCorrelationId,
        },
      });

      return ok(updatedRow);
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

      // Single active visit per doctor — block starting a second visit while
      // one is already IN_PROGRESS (any surface / stale tab / scripted call).
      if (
        body.status === "IN_PROGRESS" &&
        before.status !== "IN_PROGRESS" &&
        ctx.kind === "TENANT"
      ) {
        const active = await findOtherActiveVisit({
          clinicId: ctx.clinicId,
          doctorId: before.doctorId,
          excludeAppointmentId: id,
        });
        if (active) {
          return conflict("another_visit_in_progress", {
            activeAppointmentId: active.id,
            activePatientName: active.patientName,
          });
        }
      }
    }

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

    if (timeChanged) {
      const date = body.date ?? before.date;
      const time = body.time === undefined ? before.time : body.time;
      const dur = body.durationMin ?? before.durationMin;
      startAt = applyTime(date, time);
      endAt = computeEndDate(startAt, dur);
      const doctorId = body.doctorId ?? before.doctorId;
      const c = await detectConflicts({
        doctorId,
        cabinetId: nextCabinetId,
        startAt,
        endAt,
        excludeId: id,
      });
      if (!c.ok) {
        return conflict(c.reason, c.until ? { until: c.until } : undefined);
      }
    }

    const data: Record<string, unknown> = { ...body };
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

    // Replace AppointmentService join rows if body.services provided.
    const services = body.services;
    delete (data as { services?: unknown }).services;

    // Recompute pricing whenever any input that could affect free-repeat
    // changed: date moved, the service set was edited, the medical-case
    // attachment shifted, or visit-level discount fields were touched. We
    // call the helper inside the same tx so the row never observes a
    // transient inconsistent state.
    const recomputeNeeded =
      timeChanged ||
      services !== undefined ||
      body.medicalCaseId !== undefined ||
      body.serviceId !== undefined ||
      discountChanged;

    // Status transitions that "destroy" a visit (CANCELLED / NO_SHOW) must
    // re-evaluate every sibling in the same case: the row being killed can
    // no longer serve as the free-repeat anchor, so the next-earliest active
    // sibling becomes the new "first" and flips back to full price.
    const statusKillsVisit =
      body.status !== undefined &&
      (body.status === "CANCELLED" || body.status === "NO_SHOW") &&
      before.status !== body.status;
    // Date changes can flip the chronological order of the case, so every
    // sibling needs re-pricing too. Same for moving an appointment between
    // cases via PATCH (the dedicated attach/detach routes handle that case
    // for themselves; this branch covers callers who use PATCH directly).
    const caseChanged =
      body.medicalCaseId !== undefined &&
      body.medicalCaseId !== before.medicalCaseId;
    const siblingRepriceNeeded =
      statusKillsVisit ||
      (timeChanged && before.medicalCaseId !== null) ||
      caseChanged;

    const patchCorrelationId = newCorrelationId();
    const txOut = await prisma.$transaction(async (tx) => {
      if (services !== undefined) {
        await tx.appointmentService.deleteMany({
          where: { appointmentId: id },
        });
        if (services.length > 0) {
          const svcRows = await tx.service.findMany({
            where: { id: { in: services.map((s) => s.serviceId) } },
            select: { id: true, priceBase: true },
          });
          const priceMap = new Map(svcRows.map((s) => [s.id, s.priceBase]));
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
      const updated = await tx.appointment.update({
        where: { id },
        data: data as never,
      });
      // Reprice the row itself first (idempotent — recomputeCaseAppointments
      // below covers it again, but this keeps the audit-meta path simple).
      const recomputed = recomputeNeeded
        ? await recomputeAppointmentPrice(tx, id)
        : null;
      // Now repropagate to every sibling whose "first vs repeat" answer
      // could have flipped from this single change. Cover both old and new
      // cases when the appointment moved between cases.
      if (siblingRepriceNeeded) {
        const targetCases = new Set<string>();
        if (updated.medicalCaseId) targetCases.add(updated.medicalCaseId);
        if (caseChanged && before.medicalCaseId) {
          targetCases.add(before.medicalCaseId);
        }
        for (const cid of targetCases) {
          await recomputeCaseAppointments(tx, cid);
        }
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
          // Queue snapshot shifts on any status flip.
          alsoQueueUpdate: statusChanged,
        });
      }
      return { after: fresh, recomputed };
    });
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
      fireTrigger({ kind: "appointment.noshow", appointmentId: id });
    } else if (timeChanged) {
      fireTrigger({ kind: "appointment.updated", appointmentId: id });
    }

    // Phase 16 Wave 3 — mint a referral reward when this is the patient's
    // very first COMPLETED visit AND the lead was tagged with a referrer
    // at sign-up. Idempotent + best-effort: a duplicate (referrer, referred)
    // pair silently no-ops and any throw is logged but never rolls back the
    // appointment status change.
    if (body.status === "COMPLETED" && !before.completedAt) {
      // Auto-messages widget — "Спасибо за визит" on the COMPLETED transition.
      // Best-effort + idempotent; no-op when the clinic has it toggled off.
      fireTrigger({ kind: "appointment.completed", appointmentId: id });
      try {
        await mintReferralRewardOnCompletion({
          tx: prisma,
          request,
          clinicId: after.clinicId,
          appointmentId: id,
          patientId: after.patientId,
        });
      } catch (e) {
        console.error("[referral-mint] failed for appointment", id, e);
      }
      await bumpPatientLastContact(
        after.patientId,
        after.completedAt ?? new Date(),
      );
    }

    return ok(after);
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
