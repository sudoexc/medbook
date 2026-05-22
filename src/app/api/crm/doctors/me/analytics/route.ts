/**
 * /api/crm/doctors/me/analytics — clinical KPI tiles for the doctor's
 * personal analytics page (Phase G8).
 *
 * Returns a flat set of counters scoped to the calling DOCTOR + a per-day
 * series for the daily Rx/sick-leave/lab volume sparklines. Range is
 * driven by `?from=YYYY-MM-DD&to=YYYY-MM-DD`; both default to a 30-day
 * window ending today so a stale tab still renders something sensible.
 *
 * Counters in scope:
 *   completedAppointments — Appointment.status=COMPLETED for this doctor.
 *   finalizedNotes        — VisitNote.status=FINALIZED for this doctor.
 *   protocolApplied       — VisitNotes that were stamped by an Apply-Standard
 *                          protocol (heuristic: bodyMarkdown contains the
 *                          protocol-applied marker). Phase G2 stamps this in
 *                          the body itself; counting it here is cheap and
 *                          avoids a new join table.
 *   rxIssued / slIssued   — Counters from the G7 tables, doctorId=userId.
 *   labOrdersIssued       — LabOrder.doctorId=userId.
 *   cdsOverrides          — CdsOverride.doctorId=userId.
 *   labResultsReviewed    — LabResult.reviewedAt!=null && reviewedById=userId
 *                          (only when the schema has that column; otherwise
 *                          falls back to reviewedAt!=null).
 *
 * The doctor model uses two id namespaces (Doctor.id vs User.id) — G7+G8
 * rows store User.id while VisitNote/Appointment use Doctor.id. We resolve
 * both ids up front and pass the appropriate one to each query.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { z } from "zod";
import { parseQuery } from "@/server/http";

const QuerySchema = z.object({
  // Inclusive YYYY-MM-DD bounds. Both default to a 30-day window ending
  // today (resolved server-side to avoid timezone drift on the client).
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type DailyBucket = {
  date: string;
  rx: number;
  sl: number;
  labs: number;
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

    const today = startOfDay(new Date());
    const to = q.to ? endOfDay(parseYMD(q.to)) : endOfDay(new Date());
    const from = q.from ? startOfDay(parseYMD(q.from)) : startOfDay(addDays(today, -29));
    if (to < from) return err("BadRequest", 400, { reason: "to_before_from" });

    const userId = ctx.userId;
    const doctorRowId = doctor.id;
    const clinicId = ctx.clinicId;

    // Run aggregate counts in parallel — six small queries beat a single
    // mega-join here because Prisma can't aggregate across heterogeneous
    // tables in one trip anyway.
    const [
      completedAppointments,
      finalizedNotesAgg,
      rxAgg,
      slAgg,
      labOrdersAgg,
      cdsOverrideAgg,
      labResultsReviewedAgg,
      rxRows,
      slRows,
      labRows,
      overrideRows,
    ] = await Promise.all([
      prisma.appointment.count({
        where: {
          clinicId,
          doctorId: doctorRowId,
          status: "COMPLETED",
          date: { gte: from, lte: to },
        },
      }),
      prisma.visitNote.findMany({
        where: {
          clinicId,
          doctorId: doctorRowId,
          status: "FINALIZED",
          finalizedAt: { gte: from, lte: to },
        },
        select: { id: true, bodyMarkdown: true },
      }),
      prisma.ePrescription.count({
        where: {
          clinicId,
          doctorId: userId,
          status: "ISSUED",
          issuedAt: { gte: from, lte: to },
        },
      }),
      prisma.sickLeave.count({
        where: {
          clinicId,
          doctorId: userId,
          status: "ISSUED",
          issuedAt: { gte: from, lte: to },
        },
      }),
      prisma.labOrder.count({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.cdsOverride.count({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.labResult.count({
        where: {
          clinicId,
          doctorId: userId,
          reviewedAt: { gte: from, lte: to, not: null },
        },
      }),
      prisma.ePrescription.findMany({
        where: {
          clinicId,
          doctorId: userId,
          status: "ISSUED",
          issuedAt: { gte: from, lte: to },
        },
        select: { issuedAt: true },
      }),
      prisma.sickLeave.findMany({
        where: {
          clinicId,
          doctorId: userId,
          status: "ISSUED",
          issuedAt: { gte: from, lte: to },
        },
        select: { issuedAt: true },
      }),
      prisma.labOrder.findMany({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true },
      }),
      prisma.cdsOverride.findMany({
        where: {
          clinicId,
          doctorId: userId,
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true },
      }),
    ]);

    const finalizedNotes = finalizedNotesAgg.length;
    const protocolApplied = finalizedNotesAgg.filter((n) =>
      hasProtocolMarker(n.bodyMarkdown),
    ).length;
    const protocolAppliedPct =
      finalizedNotes > 0
        ? Math.round((protocolApplied / finalizedNotes) * 100)
        : 0;

    // Daily buckets (UTC days for stability; client renders in local TZ).
    const dayCount =
      Math.floor((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000) + 1;
    const buckets: DailyBucket[] = [];
    for (let i = 0; i < dayCount; i++) {
      const d = addDays(from, i);
      buckets.push({
        date: toYMD(d),
        rx: 0,
        sl: 0,
        labs: 0,
        overrides: 0,
      });
    }
    const bucketIndex = new Map<string, DailyBucket>(
      buckets.map((b) => [b.date, b]),
    );
    for (const r of rxRows) bumpBucket(bucketIndex, r.issuedAt, "rx");
    for (const r of slRows) bumpBucket(bucketIndex, r.issuedAt, "sl");
    for (const r of labRows) bumpBucket(bucketIndex, r.createdAt, "labs");
    for (const r of overrideRows) bumpBucket(bucketIndex, r.createdAt, "overrides");

    return ok({
      range: { from: toYMD(from), to: toYMD(to) },
      kpis: {
        completedAppointments,
        finalizedNotes,
        protocolApplied,
        protocolAppliedPct,
        rxIssued: rxAgg,
        slIssued: slAgg,
        labOrdersIssued: labOrdersAgg,
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
  key: "rx" | "sl" | "labs" | "overrides",
) {
  const k = toYMD(at);
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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function parseYMD(s: string): Date {
  const [y, m, dd] = s.split("-").map((p) => Number.parseInt(p, 10));
  return new Date(y, m - 1, dd);
}
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
