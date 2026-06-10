/**
 * Ф7 — последний FINALIZED VisitNote этого пациента у этого врача.
 *
 * Один источник для copy-forward endpoint'а и print-роута (дифф лечения):
 * для DRAFT-заметки это просто последний финализированный визит; для уже
 * финализированной (повторная печать) — строго предшествующий по
 * finalizedAt, чтобы дифф не сравнил визит сам с собой.
 */
import { prisma } from "@/lib/prisma";

export async function findPreviousFinalizedVisit(note: {
  id: string;
  patientId: string;
  doctorId: string;
  finalizedAt: Date | null;
}) {
  return prisma.visitNote.findFirst({
    where: {
      patientId: note.patientId,
      doctorId: note.doctorId,
      status: "FINALIZED",
      id: { not: note.id },
      ...(note.finalizedAt ? { finalizedAt: { lt: note.finalizedAt } } : {}),
    },
    orderBy: { finalizedAt: "desc" },
    select: {
      id: true,
      finalizedAt: true,
      diagnosisCode: true,
      diagnosisName: true,
      complaints: true,
      anamnesis: true,
      dynamics: true,
      visitPrescriptions: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export type PreviousFinalizedVisit = NonNullable<
  Awaited<ReturnType<typeof findPreviousFinalizedVisit>>
>;
