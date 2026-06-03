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
 */

import { prisma } from "@/lib/prisma";

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
};

/**
 * Decide what to do with the freshly-created appointment's case binding.
 * Idempotent on failure — the appointment row already exists and the caller
 * can retry / let the receptionist attach manually from CRM.
 */
export async function autoAttachCase(
  input: AutoAttachCaseInput,
): Promise<CaseAttachOutcome> {
  try {
    const openCases = await prisma.medicalCase.findMany({
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
        { day: "2-digit", month: "2-digit", year: "numeric" },
      );
      const title = isUz
        ? `Yangi shikoyat, ${dStr}`
        : `Новая жалоба, ${dStr}`;
      const created = await prisma.medicalCase.create({
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
      await prisma.appointment.update({
        where: { id: input.appointmentId },
        data: { medicalCaseId: created.id },
      });
      return { kind: "created", caseId: created.id, title };
    }

    if (openCases.length === 1) {
      const target = openCases[0]!;
      await prisma.appointment.update({
        where: { id: input.appointmentId },
        data: { medicalCaseId: target.id },
      });
      return { kind: "auto", caseId: target.id };
    }

    // 2+ — patient picks.
    return {
      kind: "needs_choice",
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
  } catch (caseErr) {
    console.error("[cases.autoAttach]", caseErr);
    return {
      kind: "skipped",
      reason:
        caseErr instanceof Error ? caseErr.message : "case_attach_failed",
    };
  }
}
