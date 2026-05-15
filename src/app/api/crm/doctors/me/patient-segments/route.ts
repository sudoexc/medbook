/**
 * GET /api/crm/doctors/me/patient-segments — doctor-scoped patient
 * segmentation for the SegmentationCard donut on /doctor/patients.
 *
 * Scope is "my patients" only — a patient is "mine" if they have at least
 * one COMPLETED appointment with this doctor. We deliberately exclude
 * BOOKED-but-never-arrived patients so the buckets reflect actual care
 * history, not roster noise.
 *
 * Classification lives in `src/lib/doctor-patient-segments.ts` and is
 * shared with `/api/crm/doctors/me/patients?tab=*` so the donut and the
 * table can never disagree.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import {
  classifyDoctorSegment,
  DAY_MS,
  DOCTOR_SEGMENT_KEYS,
  DOCTOR_SEGMENT_LABELS_RU,
  type DoctorSegmentKey,
} from "@/lib/doctor-patient-segments";

export type SegmentKey = DoctorSegmentKey;

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
      const key = classifyDoctorSegment(row._count._all, daysSinceLast);
      counts[key] += 1;
    }

    const total = grouped.length;

    const segments: SegmentRow[] = DOCTOR_SEGMENT_KEYS.map((key) => {
      const count = counts[key];
      const percent =
        total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
      return { key, label: DOCTOR_SEGMENT_LABELS_RU[key], count, percent };
    });

    const payload: SegmentResponse = { total, segments };
    return ok(payload);
  },
);
