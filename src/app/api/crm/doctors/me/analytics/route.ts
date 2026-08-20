/**
 * /api/crm/doctors/me/analytics — clinical KPI tiles for the doctor's
 * personal analytics page (Phase G8).
 *
 * Returns a flat set of counters scoped to the calling DOCTOR + a per-day
 * series for the daily activity sparklines. Range is driven by
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`; both default to a 30-day window ending
 * today so a stale tab still renders something sensible.
 *
 * Counters in scope:
 *   completedAppointments — Appointment.status=COMPLETED for this doctor.
 *   finalizedNotes        — VisitNote.status=FINALIZED for this doctor.
 *   protocolApplied       — VisitNotes that were stamped by an Apply-Standard
 *                          protocol (heuristic: bodyMarkdown contains the
 *                          protocol-applied marker). Phase G2 stamps this in
 *                          the body itself; counting it here is cheap and
 *                          avoids a new join table.
 *   cdsOverrides          — CdsOverride.doctorId=userId.
 *   labResultsReviewed    — LabResult.reviewedAt!=null && reviewedById=userId
 *                          (only when the schema has that column; otherwise
 *                          falls back to reviewedAt!=null).
 *
 * Deliberately NOT counted: ePrescription / SickLeave / LabOrder issuance.
 * The visit-screen buttons that created those rows were removed in the
 * interface simplification, so a doctor cannot produce them anymore — the
 * KPIs would read as eternal zeros and look broken. The G7 tables and their
 * CRUD routes stay untouched; resurrect the counters from git history if
 * the buttons ever come back. This endpoint's only consumer is the doctor
 * analytics dashboard (`src/app/[locale]/doctor/analytics/**`).
 *
 * The doctor model uses two id namespaces (Doctor.id vs User.id) — G7+G8
 * rows store User.id while VisitNote/Appointment use Doctor.id. We resolve
 * both ids up front and pass the appropriate one to each query.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
} from "@/lib/booking-validation";
import { ok, err } from "@/server/http";
import { z } from "zod";
import { parseQuery } from "@/server/http";

const DAY_MS = 24 * 60 * 60 * 1000;

const QuerySchema = z.object({
  // Inclusive YYYY-MM-DD bounds. Both default to a 30-day window ending
  // today (resolved server-side to avoid timezone drift on the client).
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Daily series mirrors the KPI set: only activity the doctor can actually
// generate from the current UI (visits, conclusions, CDS overrides).
type DailyBucket = {
  date: string;
  appointments: number;
  notes: number;
  overrides: number;
};

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, userId: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    // All day boundaries are Tashkent (clinic time): `from` inclusive,
    // `toEnd` exclusive (midnight after the requested `to` day).
    const now = new Date();
    const todayBounds = tashkentDayBounds(now);
    const toEnd = q.to
      ? tashkentDayBoundsForDateString(q.to).dayEnd
      : todayBounds.dayEnd;
    const from = q.from
      ? tashkentDayBoundsForDateString(q.from).dayStart
      : new Date(todayBounds.dayStart.getTime() - 29 * DAY_MS);
    if (toEnd <= from) return err("BadRequest", 400, { reason: "to_before_from" });

    const userId = ctx.userId;
    const doctorRowId = doctor.id;
    const clinicId = ctx.clinicId;

    // Run the queries in parallel — several small queries beat a single
    // mega-join here because Prisma can't aggregate across heterogeneous
    // tables in one trip anyway. Row-level selects (dates only) feed the
    // daily buckets; counts derive from the same rows where possible.
    const [
      appointmentRows,
      finalizedNotesAgg,
      cdsOverrideAgg,
      labResultsReviewedAgg,
      overrideRows,
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          clinicId,
          doctorId: doctorRowId,
          status: "COMPLETED",
          date: { gte: from, lt: toEnd },
        },
        select: { date: true },
      }),
      prisma.visitNote.findMany({
        where: {
          clinicId,
          doctorId: doctorRowId,
          status: "FINALIZED",
          finalizedAt: { gte: from, lt: toEnd },
        },
        select: { id: true, bodyMarkdown: true, finalizedAt: true },
      }),
      prisma.cdsOverride.count({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lt: toEnd },
        },
      }),
      prisma.labResult.count({
        where: {
          clinicId,
          doctorId: userId,
          reviewedAt: { gte: from, lt: toEnd, not: null },
        },
      }),
      prisma.cdsOverride.findMany({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lt: toEnd },
        },
        select: { createdAt: true },
      }),
    ]);

    const completedAppointments = appointmentRows.length;
    const finalizedNotes = finalizedNotesAgg.length;
    const protocolApplied = finalizedNotesAgg.filter((n) =>
      hasProtocolMarker(n.bodyMarkdown),
    ).length;
    const protocolAppliedPct =
      finalizedNotes > 0
        ? Math.round((protocolApplied / finalizedNotes) * 100)
        : 0;

    // Daily buckets keyed by Tashkent civil date — the same day definition
    // the queries above filter on, so a 01:00 visit lands in its clinic day.
    // Tashkent has no DST, so stepping in 24h increments is exact.
    const dayCount = Math.round((toEnd.getTime() - from.getTime()) / DAY_MS);
    const buckets: DailyBucket[] = [];
    for (let i = 0; i < dayCount; i++) {
      buckets.push({
        date: tashkentComponents(new Date(from.getTime() + i * DAY_MS)).date,
        appointments: 0,
        notes: 0,
        overrides: 0,
      });
    }
    const bucketIndex = new Map<string, DailyBucket>(
      buckets.map((b) => [b.date, b]),
    );
    for (const r of appointmentRows) {
      bumpBucket(bucketIndex, r.date, "appointments");
    }
    for (const n of finalizedNotesAgg) {
      // finalizedAt is set on the FINALIZED transition, but the column is
      // nullable — guard so a legacy row can't crash the whole dashboard.
      if (n.finalizedAt) bumpBucket(bucketIndex, n.finalizedAt, "notes");
    }
    for (const r of overrideRows) bumpBucket(bucketIndex, r.createdAt, "overrides");

    return ok({
      range: {
        from: tashkentComponents(from).date,
        // `toEnd` is exclusive — step back one day for the inclusive label.
        to: tashkentComponents(new Date(toEnd.getTime() - DAY_MS)).date,
      },
      kpis: {
        completedAppointments,
        finalizedNotes,
        protocolApplied,
        protocolAppliedPct,
        cdsOverrides: cdsOverrideAgg,
        labResultsReviewed: labResultsReviewedAgg,
      },
      daily: buckets,
    });
  },
);

function bumpBucket(
  idx: Map<string, DailyBucket>,
  at: Date,
  key: "appointments" | "notes" | "overrides",
) {
  const k = tashkentComponents(at).date;
  const b = idx.get(k);
  if (b) b[key]++;
}

function hasProtocolMarker(md: string | null): boolean {
  if (!md) return false;
  // Phase G2 inserts a heading "Применён протокол:" when Apply-Standard
  // runs; this is the cheapest way to count without joining a separate
  // ProtocolApplied table.
  return md.includes("Применён протокол") || md.includes("Применен протокол");
}

