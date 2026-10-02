/**
 * «Следующий визит» for the patients list and the patient card (audit PT-25).
 *
 * `Patient.nextVisitAt` was reserved in the schema, but no booking path ever
 * wrote it: the list's default-on column read «Нет записи» for a patient
 * booked for tomorrow, and the card advised «Записать на повторный визит»
 * to someone already booked. Keeping a denormalised copy in sync would mean
 * touching every path that books, moves, cancels, completes or misses a
 * visit (CRM, reception, walk-in, kiosk, Mini App, call center, the
 * lifecycle sweep), and one forgotten path is the same lie again. Two
 * endpoints read it, so they ask the appointments instead: the earliest
 * visit still ahead, by the rule the segment sweep uses for «booked ahead»
 * (`upcomingVisitWhere`: still expected or on the table, from the start of
 * today in Tashkent).
 */
import { prisma } from "@/lib/prisma";
import { upcomingVisitWhere } from "@/lib/patients/segment-rules";

/** Patient id → start of that patient's next visit; absent means none. */
export async function loadNextVisitAt(
  patientIds: ReadonlyArray<string>,
  now: Date = new Date(),
): Promise<Map<string, Date>> {
  const next = new Map<string, Date>();
  if (patientIds.length === 0) return next;
  const rows = (await prisma.appointment.findMany({
    where: upcomingVisitWhere(patientIds, now),
    select: { patientId: true, date: true },
    orderBy: { date: "asc" },
  })) as Array<{ patientId: string; date: Date }>;
  for (const r of rows) {
    if (!next.has(r.patientId)) next.set(r.patientId, r.date);
  }
  return next;
}
