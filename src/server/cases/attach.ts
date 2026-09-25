/**
 * Medical-case auto-attach — shared kernel.
 *
 * Lifted from the mini-app booking handler so any surface (CRM walk-in,
 * call-center one-shot, future voice-bot) can opt-in to "create-or-attach a
 * case for this appointment" without duplicating the 0/1/2+ open-case logic.
 *
 * Patient-facing semantics (mini-app contract — do NOT mention "Случай" /
 * "Davolanish" in any return path that leaks to the patient UI):
 *
 *   0 open cases  → silently auto-create a new "Новая жалоба, <date>" case
 *                   and attach.
 *   1 open case   → silently auto-attach.
 *   2+ open cases → return `needs_choice` so the patient picks.
 *
 * Failures NEVER block the surrounding booking — the caller stores the
 * appointment first, then calls this. We log + return `skipped` instead of
 * throwing so the booking's success path is preserved.
 *
 * Runs *outside* the booking tx because (a) it owns its own writes (case
 * create + appointment.medicalCaseId update) and (b) a slow case-attach must
 * not extend the Serializable booking tx and increase the conflict window.
 *
 * Every attach goes through `attachAppointmentToCase`, which re-prices the
 * visit and its siblings in the same transaction (audit PT-02): the Mini App
 * paths used to set `medicalCaseId` bare, so a follow-up inside the service's
 * `freeRepeatDays` kept its full price, while the same attach from the CRM
 * made it free. The price must not depend on the booking channel.
 */

import { prisma } from "@/lib/prisma";
import {
  recomputeAppointmentPrice,
  type RecomputeResult,
} from "@/server/pricing/recompute-appointment-price";
import type { Actor, Surface } from "@/server/realtime/envelope";

/** Either the prisma singleton or the `$transaction` callback parameter. */
type PrismaTx =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Link an appointment to a case and re-price every visit whose «first vs
 * repeat» position this move can flip:
 *   - the appointment itself (now possibly a repeat in the new case),
 *   - every visit already in the destination case (the newcomer may become
 *     the new earliest),
 *   - every visit left behind in the case it came from, if any.
 * Run it inside a transaction so the link and the prices commit together.
 * Returns one result per re-priced visit, for the free-repeat audit.
 */
export async function attachAppointmentToCase(
  tx: PrismaTx,
  args: { appointmentId: string; caseId: string; previousCaseId: string | null },
): Promise<RecomputeResult[]> {
  await tx.appointment.update({
    where: { id: args.appointmentId },
    data: { medicalCaseId: args.caseId } as never,
  });

  const affected = new Set<string>([args.appointmentId]);
  const siblings = await tx.appointment.findMany({
    where: { medicalCaseId: args.caseId },
    select: { id: true },
  });
  for (const s of siblings) affected.add(s.id);
  if (args.previousCaseId && args.previousCaseId !== args.caseId) {
    const left = await tx.appointment.findMany({
      where: { medicalCaseId: args.previousCaseId },
      select: { id: true },
    });
    for (const s of left) affected.add(s.id);
  }

  const results: RecomputeResult[] = [];
  for (const id of affected) {
    results.push(await recomputeAppointmentPrice(tx, id));
  }
  return results;
}

/** Who attached the visit, for audit rows written without a staff request. */
export type CaseAttachAuditActor = {
  clinicId: string;
  actor: Actor;
  surface: Surface;
  correlationId?: string | null;
};

/**
 * `appointment.free_repeat_applied` for every visit the attach made free,
 * the same audit the CRM attach writes, for the patient-driven paths that
 * have no staff session to hang `audit(request, …)` on.
 */
export async function auditFreeRepeats(
  tx: PrismaTx,
  who: CaseAttachAuditActor,
  caseId: string,
  results: ReadonlyArray<RecomputeResult>,
  triggeredBy: string,
): Promise<void> {
  for (const r of results) {
    if (r.reason !== "free_repeat") continue;
    await tx.auditLog.create({
      data: {
        clinicId: who.clinicId,
        actorId: who.actor.userId,
        actorRole: who.actor.userId ? null : who.actor.role,
        actorLabel: who.actor.userId ? null : who.actor.label,
        action: "appointment.free_repeat_applied",
        entityType: "Appointment",
        entityId: r.appointmentId,
        meta: {
          caseId,
          daysFromFirst: r.daysFromFirst,
          savedAmount: r.savedAmount,
          trace: r.trace,
          triggeredBy,
          correlationId: who.correlationId ?? null,
        } as never,
        ip: null,
        userAgent: null,
        surface: who.surface,
        correlationId: who.correlationId ?? null,
      },
    });
  }
}

/**
 * Serialise case auto-creation per patient. Two bookings racing with no open
 * case both read «0 open cases» and each created «Новая жалоба» (PT-02); the
 * transaction-scoped advisory lock makes the second one wait and then see the
 * first one's case. Released automatically at commit / rollback.
 */
async function lockPatientCases(tx: PrismaTx, patientId: string): Promise<void> {
  // 2-key form: a fixed namespace for «patient case attach», then the patient.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7342, hashtext(${patientId}))`;
}

export type CaseAttachChoice = {
  id: string;
  title: string;
  primaryDoctorName: string | null;
  lastVisitAt: string | null;
  visitCount: number;
};

export type CaseAttachOutcome =
  | { kind: "auto"; caseId: string }
  | { kind: "created"; caseId: string; title: string }
  | { kind: "needs_choice"; choices: CaseAttachChoice[] }
  | { kind: "skipped"; reason: string };

export type AutoAttachCaseInput = {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  doctorId: string;
  startAt: Date;
  /** Used to localise the auto-created case title. */
  preferredLang: "RU" | "UZ";
  /** Optional patient-typed comment becomes the case `primaryComplaint`. */
  primaryComplaint: string | null;
  /** Who is booking, for the free-repeat audit row (the booking kernel's actor). */
  audit: Omit<CaseAttachAuditActor, "clinicId">;
};

/**
 * Decide what to do with the freshly-created appointment's case binding.
 * Idempotent on failure — the appointment row already exists and the caller
 * can retry / let the receptionist attach manually from CRM.
 */
export async function autoAttachCase(
  input: AutoAttachCaseInput,
): Promise<CaseAttachOutcome> {
  const who: CaseAttachAuditActor = { clinicId: input.clinicId, ...input.audit };
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPatientCases(tx, input.patientId);

      const openCases = await tx.medicalCase.findMany({
        where: {
          clinicId: input.clinicId,
          patientId: input.patientId,
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
        const isUz = input.preferredLang === "UZ";
        const dStr = input.startAt.toLocaleDateString(
          isUz ? "uz-Latn-UZ" : "ru-RU",
          {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Tashkent",
          },
        );
        const title = isUz
          ? `Yangi shikoyat, ${dStr}`
          : `Новая жалоба, ${dStr}`;
        const created = await tx.medicalCase.create({
          data: {
            clinicId: input.clinicId,
            patientId: input.patientId,
            title,
            primaryDoctorId: input.doctorId,
            primaryComplaint: input.primaryComplaint?.trim() || null,
            status: "OPEN",
          },
          select: { id: true },
        });
        const results = await attachAppointmentToCase(tx, {
          appointmentId: input.appointmentId,
          caseId: created.id,
          previousCaseId: null,
        });
        await auditFreeRepeats(tx, who, created.id, results, "auto_attach");
        return { kind: "created" as const, caseId: created.id, title };
      }

      if (openCases.length === 1) {
        const target = openCases[0]!;
        const results = await attachAppointmentToCase(tx, {
          appointmentId: input.appointmentId,
          caseId: target.id,
          previousCaseId: null,
        });
        await auditFreeRepeats(tx, who, target.id, results, "auto_attach");
        return { kind: "auto" as const, caseId: target.id };
      }

      // 2+ — patient picks.
      return {
        kind: "needs_choice" as const,
        choices: openCases.map((c) => ({
          id: c.id,
          title: c.title,
          primaryDoctorName: c.primaryDoctor
            ? input.preferredLang === "UZ"
              ? c.primaryDoctor.nameUz
              : c.primaryDoctor.nameRu
            : null,
          lastVisitAt: c.appointments[0]?.date.toISOString() ?? null,
          visitCount: c._count.appointments,
        })),
      };
    });
  } catch (caseErr) {
    console.error("[cases.autoAttach]", caseErr);
    return {
      kind: "skipped",
      reason:
        caseErr instanceof Error ? caseErr.message : "case_attach_failed",
    };
  }
}
