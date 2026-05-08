/**
 * GET /api/miniapp/appointments?clinicSlug=… — list patient's appointments.
 *   Query: scope=upcoming|past (default "upcoming"), limit?.
 *
 * POST /api/miniapp/appointments — book an appointment.
 *   Body: { doctorId, serviceIds[], startAt (ISO), patientName?, patientPhone?, lang? }
 *
 * Both are scoped to the authenticated patient (via `ctx.patientId`) and the
 * clinic (via `ctx.clinicId`).
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { normalizePhone } from "@/lib/phone";
import { conflict, err, ok } from "@/server/http";
import { createMiniAppHandler, createMiniAppListHandler } from "@/server/miniapp/handler";
import {
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";

const BookBody = z.object({
  doctorId: z.string().min(1),
  serviceIds: z.array(z.string()).min(1),
  startAt: z.string().datetime(),
  patientName: z.string().trim().min(1).optional(),
  patientPhone: z.string().trim().optional(),
  lang: z.enum(["RU", "UZ"]).optional(),
  comments: z.string().max(1000).optional(),
  // Phase 16: when set, the booking is created against a linked relative.
  // The TG-authenticated owner remains the actor in audit/notifications,
  // but the appointment.patientId is the relative's id. Server validates
  // the PatientFamily link before honouring this.
  onBehalfOf: z.string().min(1).optional(),
});

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "upcoming";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    100,
  );
  // Phase 16 — optional `onBehalfOf` to read a linked relative's list.
  const onBehalfOf = url.searchParams.get("onBehalfOf");
  let listPatientId = ctx.patientId;
  if (onBehalfOf && onBehalfOf !== ctx.patientId) {
    const link = await prisma.patientFamily.findFirst({
      where: {
        clinicId: ctx.clinicId,
        ownerPatientId: ctx.patientId,
        linkedPatientId: onBehalfOf,
      },
      select: { id: true },
    });
    if (!link) return err("on_behalf_of_not_linked", 403);
    listPatientId = onBehalfOf;
  }
  const now = new Date();
  const where: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    patientId: listPatientId,
  };
  if (scope === "upcoming") {
    where.status = { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] };
    where.date = { gte: now };
  } else {
    where.OR = [
      { status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
      { date: { lt: now } },
    ];
  }
  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { date: scope === "upcoming" ? "asc" : "desc" },
    take: limit,
    include: {
      doctor: {
        select: {
          id: true,
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
          photoUrl: true,
        },
      },
      cabinet: { select: { id: true, number: true } },
      primaryService: { select: { id: true, nameRu: true, nameUz: true } },
      services: {
        include: {
          service: {
            select: { id: true, nameRu: true, nameUz: true, priceBase: true },
          },
        },
      },
      payments: { select: { id: true, amount: true, status: true, method: true } },
    },
  });
  return ok({ appointments: rows });
});

export const POST = createMiniAppHandler(
  { bodySchema: BookBody },
  async ({ request, body, ctx }) => {
    // Phase 16 — resolve booking patient (self vs linked relative).
    // The TG owner stays the audit actor; we just swap the patientId we
    // attach to the appointment so the relative is the medical subject.
    let bookingPatientId = ctx.patientId;
    let bookingPatientLang: "RU" | "UZ" = ctx.patient.preferredLang;
    if (body.onBehalfOf && body.onBehalfOf !== ctx.patientId) {
      const link = await prisma.patientFamily.findFirst({
        where: {
          clinicId: ctx.clinicId,
          ownerPatientId: ctx.patientId,
          linkedPatientId: body.onBehalfOf,
        },
        select: {
          linkedPatient: { select: { id: true, preferredLang: true } },
        },
      });
      if (!link?.linkedPatient) return err("on_behalf_of_not_linked", 403);
      bookingPatientId = link.linkedPatient.id;
      bookingPatientLang =
        (link.linkedPatient.preferredLang as "RU" | "UZ" | null) ??
        ctx.patient.preferredLang;
    }

    // Confirm doctor + services belong to this clinic.
    const [doctor, services] = await Promise.all([
      prisma.doctor.findFirst({
        where: { id: body.doctorId, clinicId: ctx.clinicId, isActive: true },
        select: {
          id: true,
          cabinetId: true,
          cabinet: { select: { isActive: true } },
        },
      }),
      prisma.service.findMany({
        where: {
          id: { in: body.serviceIds },
          clinicId: ctx.clinicId,
          isActive: true,
        },
        select: { id: true, priceBase: true, durationMin: true },
      }),
    ]);
    if (!doctor) return err("doctor_not_found", 404);
    if (!doctor.cabinet?.isActive) return err("cabinet_inactive", 422);
    if (services.length !== body.serviceIds.length) {
      return err("service_not_found", 404);
    }
    const durationMin = services.reduce((a, s) => a + s.durationMin, 0) || 30;
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) return err("bad_start_at", 400);
    const endAt = computeEndDate(startAt, durationMin);

    // Optional profile update: sync name/phone/lang from the booking form
    // — but ONLY when booking for self. When acting on behalf of a relative,
    // the form fields belong to the relative; we skip this profile-update
    // step so the owner's TG-tied profile stays intact, and we don't risk
    // clobbering a relative profile that was created via the family form.
    const isOnBehalfOf = bookingPatientId !== ctx.patientId;
    if (!isOnBehalfOf) {
      const patientUpdate: Record<string, unknown> = {};
      if (body.patientName && body.patientName !== ctx.patient.fullName) {
        patientUpdate.fullName = body.patientName;
      }
      if (body.patientPhone) {
        const normalized = normalizePhone(body.patientPhone);
        if (normalized && !normalized.startsWith("tg:")) {
          patientUpdate.phone = body.patientPhone;
          patientUpdate.phoneNormalized = normalized;
        }
      }
      if (body.lang && body.lang !== ctx.patient.preferredLang) {
        patientUpdate.preferredLang = body.lang;
      }
      if (Object.keys(patientUpdate).length > 0) {
        await prisma.patient.update({
          where: { id: ctx.patientId },
          data: patientUpdate,
        });
      }
    }

    // Compute price snapshot.
    const priceBase = services.reduce((a, s) => a + s.priceBase, 0);
    const primaryServiceId = body.serviceIds[0] ?? null;

    // Phase 16 Wave 3 — auto-apply the most recent PENDING referral
    // reward that the booking patient owns (the referrer is the one
    // booking, the redeemer is one of their friends). The discount is
    // computed off `priceBase` and snapshot into `discountPct` so the
    // CRM payment engine sees it like any other manual discount.
    let referralDiscountPct = 0;
    let referralRewardId: string | null = null;
    {
      const pending = await prisma.referralReward.findFirst({
        where: {
          clinicId: ctx.clinicId,
          referrerPatientId: bookingPatientId,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, rewardPercent: true },
      });
      if (pending && priceBase > 0) {
        referralRewardId = pending.id;
        referralDiscountPct = Math.max(
          0,
          Math.min(50, Math.floor(pending.rewardPercent)),
        );
      }
    }
    const referralDiscountAmount =
      referralDiscountPct > 0
        ? Math.round((priceBase * referralDiscountPct) / 100)
        : 0;
    const priceFinal = Math.max(0, priceBase - referralDiscountAmount);

    const time = `${String(startAt.getHours()).padStart(2, "0")}:${String(
      startAt.getMinutes(),
    ).padStart(2, "0")}`;

    let txResult:
      | { kind: "ok"; appt: Awaited<ReturnType<typeof prisma.appointment.create>> }
      | { kind: "conflict"; reason: string; until?: string };
    try {
      txResult = await prisma.$transaction(
        async (tx) => {
          const c = await detectConflicts(
            {
              doctorId: body.doctorId,
              cabinetId: doctor.cabinetId,
              startAt,
              endAt,
            },
            tx,
          );
          if (!c.ok) {
            return { kind: "conflict" as const, reason: c.reason, until: c.until };
          }
          const appt = await tx.appointment.create({
            data: {
              clinicId: ctx.clinicId,
              patientId: bookingPatientId,
              doctorId: body.doctorId,
              cabinetId: doctor.cabinetId,
              serviceId: primaryServiceId,
              date: startAt,
              time,
              durationMin,
              endDate: endAt,
              status: "BOOKED",
              queueStatus: "BOOKED",
              channel: "TELEGRAM",
              priceService: priceBase,
              priceBase,
              priceFinal,
              discountPct: referralDiscountPct,
              discountAmount: referralDiscountAmount,
              comments: body.comments ?? null,
            } as never,
          });
          await tx.appointmentService.createMany({
            data: body.serviceIds.map((sid) => ({
              clinicId: ctx.clinicId,
              appointmentId: appt.id,
              serviceId: sid,
              priceSnap: services.find((s) => s.id === sid)?.priceBase ?? 0,
              quantity: 1,
            })) as never,
          });
          // Stamp the referral reward APPLIED inside the same tx so we
          // can never double-apply across concurrent bookings.
          if (referralRewardId) {
            await tx.referralReward.update({
              where: { id: referralRewardId },
              data: {
                status: "APPLIED",
                appliedAt: new Date(),
                appliedAppointmentId: appt.id,
              },
            });
          }
          return { kind: "ok" as const, appt };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (e: unknown) {
      // Match the CRM POST: P2034 / 40001 (serialization) and 23P01
      // (exclusion_violation from the DB-level EXCLUDE constraint) all map
      // to a clean 409 instead of a generic 500.
      const err = e as {
        code?: string;
        originalCode?: string;
        kind?: string;
      } | null;
      const isWriteConflict =
        err?.code === "P2034" ||
        err?.code === "40001" ||
        err?.code === "23P01" ||
        err?.originalCode === "40001" ||
        err?.originalCode === "23P01" ||
        err?.kind === "TransactionWriteConflict";
      if (isWriteConflict) {
        const c = await detectConflicts({
          doctorId: body.doctorId,
          cabinetId: doctor.cabinetId,
          startAt,
          endAt,
        });
        if (!c.ok) {
          return conflict(c.reason, c.until ? { until: c.until } : undefined);
        }
        return conflict("doctor_busy");
      }
      throw e;
    }
    if (txResult.kind === "conflict") {
      return conflict(
        txResult.reason,
        txResult.until ? { until: txResult.until } : undefined,
      );
    }
    const created = txResult.appt;

    fireTrigger({ kind: "appointment.created", appointmentId: created.id });

    // Phase 16 Wave 3 — audit when a referral reward auto-applied to this
    // booking. The reward was already stamped APPLIED inside the tx; this
    // just leaves a trail the receptionist can read in the audit log.
    if (referralRewardId) {
      try {
        await audit(request, {
          action: AUDIT_ACTION.REFERRAL_REWARD_APPLIED,
          entityType: "ReferralReward",
          entityId: referralRewardId,
          meta: {
            appointmentId: created.id,
            patientId: bookingPatientId,
            rewardPercent: referralDiscountPct,
            discountAmount: referralDiscountAmount,
            priceBase,
            priceFinal,
          },
        });
      } catch (e) {
        console.error("[referral.applied] audit failed", e);
      }
    }

    // ─── MedicalCase auto-attach ────────────────────────────────────────────
    //
    // Patient-facing UX (per task brief): never mention "Случай" / "Davolanish"
    // — the patient sees this as a "новая жалоба" / "продолжение лечения"
    // ("yangi shikoyat" / "davolanishni davom ettirish") choice.
    //
    // Logic:
    //   0 open cases  → silently auto-create one and attach.
    //   1 open case   → silently auto-attach.
    //   2+ open cases → return `caseAttach.choices` and let the client ask.
    //
    // Failures here MUST NOT block the booking — the appointment is already
    // committed. We log + continue, leaving the appointment without a case
    // (the receptionist can attach later from CRM).
    //
    // Heuristic for auto-create:
    //   title           = "Новая жалоба, <date>" / "Yangi shikoyat, <sana>"
    //   primaryDoctorId = the booked doctor
    //   primaryComplaint = `body.comments` if the patient typed something
    let caseAttach:
      | { kind: "auto"; caseId: string }
      | { kind: "created"; caseId: string }
      | {
          kind: "needs_choice";
          choices: Array<{
            id: string;
            title: string;
            primaryDoctorName: string | null;
            lastVisitAt: string | null;
            visitCount: number;
          }>;
        }
      | { kind: "skipped"; reason: string }
      | null = null;
    try {
      const openCases = await prisma.medicalCase.findMany({
        where: {
          clinicId: ctx.clinicId,
          patientId: bookingPatientId,
          status: "OPEN",
        },
        orderBy: { updatedAt: "desc" },
        include: {
          primaryDoctor: { select: { nameRu: true, nameUz: true } },
          appointments: {
            orderBy: { date: "desc" },
            take: 1,
            select: { date: true },
          },
          _count: { select: { appointments: true } },
        },
      });

      if (openCases.length === 0) {
        // Auto-create + attach. Bind the case to the relative when on
        // behalf of, otherwise to the owner.
        const isUz = (body.lang ?? bookingPatientLang) === "UZ";
        const dStr = startAt.toLocaleDateString(
          isUz ? "uz-Latn-UZ" : "ru-RU",
          { day: "2-digit", month: "2-digit", year: "numeric" },
        );
        const newTitle = isUz
          ? `Yangi shikoyat, ${dStr}`
          : `Новая жалоба, ${dStr}`;
        const newCase = await prisma.medicalCase.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: bookingPatientId,
            title: newTitle,
            primaryDoctorId: body.doctorId,
            primaryComplaint: body.comments?.trim() || null,
            status: "OPEN",
          } as never,
          select: { id: true },
        });
        await prisma.appointment.update({
          where: { id: created.id },
          data: { medicalCaseId: newCase.id } as never,
        });
        caseAttach = { kind: "created", caseId: newCase.id };
      } else if (openCases.length === 1) {
        // Auto-attach.
        const target = openCases[0]!;
        await prisma.appointment.update({
          where: { id: created.id },
          data: { medicalCaseId: target.id } as never,
        });
        caseAttach = { kind: "auto", caseId: target.id };
      } else {
        // 2+: ask the patient. The client will call
        // POST /api/miniapp/appointments/[id]/attach-case with their choice.
        const lang = body.lang ?? bookingPatientLang;
        caseAttach = {
          kind: "needs_choice",
          choices: openCases.map((c) => ({
            id: c.id,
            title: c.title,
            primaryDoctorName: c.primaryDoctor
              ? lang === "UZ"
                ? c.primaryDoctor.nameUz
                : c.primaryDoctor.nameRu
              : null,
            lastVisitAt: c.appointments[0]?.date.toISOString() ?? null,
            visitCount: c._count.appointments,
          })),
        };
      }
    } catch (caseErr) {
      console.error("[miniapp.appointments.case_attach]", caseErr);
      caseAttach = {
        kind: "skipped",
        reason:
          caseErr instanceof Error ? caseErr.message : "case_attach_failed",
      };
    }

    return ok(
      {
        appointment: {
          id: created.id,
          date: created.date,
          endDate: created.endDate,
          time: created.time,
          durationMin: created.durationMin,
          priceFinal: created.priceFinal,
          status: created.status,
        },
        caseAttach,
      },
      201,
    );
  },
);
