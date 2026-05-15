/**
 * GET /api/crm/doctors/me/patient-segments — doctor-scoped patient
 * segmentation for the SegmentationCard donut on /doctor/patients.
 *
 * Scope is "my patients" only — a patient is "mine" if they have at least
 * one COMPLETED appointment with this doctor. We deliberately exclude
 * BOOKED-but-never-arrived patients so the buckets reflect actual care
 * history, not roster noise.
 *
 * Classification (priority top-down — first match wins so buckets don't
 * overlap):
 *   - new       : visitsCount === 1 AND daysSinceLast ≤ 30
 *   - active    : daysSinceLast ≤ 30 (and visitsCount > 1)
 *   - watch     : 30 < daysSinceLast ≤ 90
 *   - returned  : 90 < daysSinceLast ≤ 180
 *   - dormant   : daysSinceLast > 180
 *
 * Why these tones (and not `first_visit`/`returning` from the design TZ):
 * we keep the keys aligned with the existing SegmentationCard colour map
 * (`active|watch|dormant|new|returned`) — renaming the tone keys would
 * require a card refactor for zero visible gain. The semantics match the
 * spec, only the naming is preserved.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

export type SegmentKey = "active" | "watch" | "dormant" | "new" | "returned";

type SegmentRow = {
  key: SegmentKey;
  label: string;
  count: number;
  percent: number;
};

type SegmentResponse = {
  total: number;
  segments: SegmentRow[];
};

const SEGMENT_DEFS: Array<{ key: SegmentKey; label: string }> = [
  { key: "active", label: "На приёме" },
  { key: "watch", label: "На контроле" },
  { key: "returned", label: "Вернулись" },
  { key: "new", label: "Новые" },
  { key: "dormant", label: "Давно не были" },
];

function classify(visitsCount: number, daysSinceLast: number): SegmentKey {
  if (visitsCount === 1 && daysSinceLast <= 30) return "new";
  if (daysSinceLast <= 30) return "active";
  if (daysSinceLast <= 90) return "watch";
  if (daysSinceLast <= 180) return "returned";
  return "dormant";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // Appointment.doctorId → Doctor.id (not User.id) — the same indirection
    // sidebar-stats and the reminders POST handler use.
    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const grouped = await prisma.appointment.groupBy({
      by: ["patientId"],
      where: {
        doctorId: doctor.id,
        status: "COMPLETED",
      },
      _count: { _all: true },
      // `completedAt` is the actual moment the visit wrapped up; fall back
      // to `date` (scheduled wall-clock) if a legacy row never got the
      // timestamp populated.
      _max: { completedAt: true, date: true },
    });

    const now = Date.now();
    const DAY_MS = 86_400_000;

    const counts: Record<SegmentKey, number> = {
      active: 0,
      watch: 0,
      returned: 0,
      new: 0,
      dormant: 0,
    };

    for (const row of grouped) {
      const last = row._max.completedAt ?? row._max.date;
      if (!last) continue; // defensive — shouldn't happen with status=COMPLETED
      const daysSinceLast = Math.floor((now - last.getTime()) / DAY_MS);
      const key = classify(row._count._all, daysSinceLast);
      counts[key] += 1;
    }

    const total = grouped.length;

    const segments: SegmentRow[] = SEGMENT_DEFS.map(({ key, label }) => {
      const count = counts[key];
      const percent =
        total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
      return { key, label, count, percent };
    });

    const payload: SegmentResponse = { total, segments };
    return ok(payload);
  },
);
