/**
 * Shared loader for Phase 3b reception-AI endpoints. Given a noteId and
 * the calling doctor's user id, returns the VisitNote + patient demographics
 * + recent visit history + allergies — everything the AI wrappers need.
 *
 * Authorization: rejects when (a) the note doesn't exist, (b) the caller
 * isn't a doctor, or (c) the doctor isn't the note's owner.
 */

import { prisma } from "@/lib/prisma";

export type ReceptionAiContext = {
  note: {
    id: string;
    status: "DRAFT" | "FINALIZED";
    complaints: string[];
    anamnesis: string[];
    examination: string[];
    prescriptions: string[];
    advice: string[];
    diagnosisCode: string | null;
    diagnosisName: string | null;
  };
  patient: {
    id: string;
    fullName: string;
    age: number | null;
    gender: "M" | "F" | null;
  };
  recentVisits: Array<{
    date: Date;
    diagnosis: string | null;
    notes: string | null;
  }>;
  allergies: Array<{
    substance: string;
    severity: string;
  }>;
  hasAllergyRecord: boolean;
};

export type LoadResult =
  | { ok: true; ctx: ReceptionAiContext }
  | { ok: false; status: number; reason: string };

function ageFromBirthDate(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  const years = now.getFullYear() - birthDate.getFullYear();
  const before =
    now.getMonth() < birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate());
  const age = before ? years - 1 : years;
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

export async function loadReceptionAiContext(
  noteId: string,
  callerUserId: string,
): Promise<LoadResult> {
  const doctor = await prisma.doctor.findFirst({
    where: { userId: callerUserId },
    select: { id: true },
  });
  if (!doctor) return { ok: false, status: 403, reason: "not_a_doctor" };

  const note = await prisma.visitNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
      status: true,
      complaints: true,
      anamnesis: true,
      examination: true,
      prescriptions: true,
      advice: true,
      diagnosisCode: true,
      diagnosisName: true,
    },
  });
  if (!note) return { ok: false, status: 404, reason: "note_not_found" };
  if (note.doctorId !== doctor.id) {
    return { ok: false, status: 403, reason: "not_note_owner" };
  }

  const patient = await prisma.patient.findUnique({
    where: { id: note.patientId },
    select: {
      id: true,
      fullName: true,
      birthDate: true,
      gender: true,
    },
  });
  if (!patient) return { ok: false, status: 404, reason: "patient_not_found" };

  const [recentAppointments, allergies] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        patientId: note.patientId,
        status: "COMPLETED",
      },
      orderBy: { date: "desc" },
      take: 3,
      select: {
        date: true,
        visitNote: {
          select: {
            diagnosisCode: true,
            diagnosisName: true,
            bodyMarkdown: true,
          },
        },
      },
    }),
    prisma.patientAllergy.findMany({
      where: { patientId: note.patientId },
      select: { substance: true, severity: true },
      take: 20,
    }),
  ]);

  const recentVisits = recentAppointments.map((a) => ({
    date: a.date,
    diagnosis:
      a.visitNote?.diagnosisName ?? a.visitNote?.diagnosisCode ?? null,
    notes: a.visitNote?.bodyMarkdown?.slice(0, 400) ?? null,
  }));

  return {
    ok: true,
    ctx: {
      note: {
        id: note.id,
        status: note.status as "DRAFT" | "FINALIZED",
        complaints: note.complaints,
        anamnesis: note.anamnesis,
        examination: note.examination,
        prescriptions: note.prescriptions,
        advice: note.advice,
        diagnosisCode: note.diagnosisCode,
        diagnosisName: note.diagnosisName,
      },
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        age: ageFromBirthDate(patient.birthDate, new Date()),
        gender:
          patient.gender === "MALE"
            ? "M"
            : patient.gender === "FEMALE"
              ? "F"
              : null,
      },
      recentVisits,
      allergies: allergies.map((a) => ({
        substance: a.substance,
        severity: a.severity,
      })),
      hasAllergyRecord: allergies.length > 0,
    },
  };
}
