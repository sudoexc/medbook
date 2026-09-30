/**
 * Keeps `Patient.segment` true to the rule of
 * `src/lib/patients/segment-rules.ts` (audit PT-15).
 *
 * Two writers:
 *   - `refreshPatientSegment`: one patient, right after a completed visit
 *     (`runCompletionEffects`), so the second visit makes the patient
 *     «Активный» at once;
 *   - `recomputePatientSegments`: every patient, from the periodic job, for
 *     what only time changes (90 days without a visit: «Остывают»; a year:
 *     «Потерянные»; a first-timer's 90 days running out).
 * Both read the denormalised visit columns `refreshPatientVisitStats`
 * keeps, the same ones the list shows as «Визиты» and «Последний визит»,
 * so the segment never disagrees with the row next to it.
 *
 * VIP is a manual label: neither writer touches it, and the writes are
 * conditional on the row not being VIP so a label set in between wins.
 */
import { prisma } from "@/lib/prisma";
import {
  classifyPatientSegment,
  segmentChanges,
  type PatientSegmentValue,
} from "@/lib/patients/segment-rules";

const PATIENT_SELECT = {
  id: true,
  segment: true,
  visitsCount: true,
  lastVisitAt: true,
  createdAt: true,
} as const;

type PatientSegmentRow = {
  id: string;
  segment: PatientSegmentValue;
  visitsCount: number;
  lastVisitAt: Date | null;
  createdAt: Date;
};

/**
 * One patient. Call after `refreshPatientVisitStats`. Never throws: the
 * visit is already closed, a label must not fail it.
 */
export async function refreshPatientSegment(
  patientId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const row = (await prisma.patient.findUnique({
      where: { id: patientId },
      select: PATIENT_SELECT,
    })) as PatientSegmentRow | null;
    if (!row) return;
    const next = classifyPatientSegment({ ...row, current: row.segment }, now);
    if (next === row.segment) return;
    await prisma.patient.updateMany({
      where: { id: patientId, segment: { not: "VIP" } },
      data: { segment: next },
    });
  } catch (e) {
    console.warn(
      `[patient-segment] refresh failed for ${patientId}: ${(e as Error).message}`,
    );
  }
}

/** Patients read per round trip in the periodic pass. */
const PAGE = 1000;

/**
 * Every live patient of every clinic. The caller owns the tenant context
 * (the worker runs it under SYSTEM). Idempotent: a second pass right after
 * finds nothing to change.
 */
export async function recomputePatientSegments(
  now: Date = new Date(),
): Promise<{ scanned: number; changed: number }> {
  let scanned = 0;
  let changed = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows = (await prisma.patient.findMany({
      where: { deletedAt: null },
      select: PATIENT_SELECT,
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as PatientSegmentRow[];
    if (rows.length === 0) break;
    scanned += rows.length;
    const changes = segmentChanges(
      rows.map((r) => ({ ...r, current: r.segment })),
      now,
    );
    for (const [segment, ids] of changes) {
      const res = await prisma.patient.updateMany({
        where: { id: { in: ids }, segment: { not: "VIP" } },
        data: { segment },
      });
      changed += res.count;
    }
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1]!.id;
  }
  return { scanned, changed };
}
