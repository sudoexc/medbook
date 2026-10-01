/**
 * /api/crm/analytics — aggregated dashboard data (TZ §6). One endpoint,
 * one response, seven sections:
 *
 *   - revenueDaily: [{ date, amount }]               (line)
 *   - appointmentsByStatus: [{ status, count }]      (pie/bar)
 *   - noShowDaily: [{ date, rate, noShow, total }]   (line)
 *   - topDoctors: [{ doctorId, name, revenue, count }] (bar, top 10)
 *   - topServices: [{ serviceId, name, count }]      (bar, top 10)
 *   - sources: [{ source, count }]                   (pie)
 *   - ltvBuckets: [{ bucket, count }]                (histogram)
 *   - ltv: { averageTiins, patients }                (LTV tile, AN-05)
 *   - paymentsTracked                                (money tiles, see below)
 *   - clinicLoad: { daily, bookedMin, workingMin, loadPct, previous }
 *                                                     (line, UX-03)
 *   - deltas: { revenuePct, noShowPp, loadPp }       (chips, UX-03)
 *
 * Deltas compare the window with the one of equal length right before it
 * (`period-compare.ts`), null when the earlier window has nothing to
 * compare with. The dashboard used to split the window in halves in the
 * browser, which made a flat week read «+33 %».
 *
 * Money is only shown once the clinic records every payment in the CRM
 * (Clinic.paymentsTrackedSince, `paymentsRecordedSince`). Until then the few
 * payments someone happened to enter would pass for the clinic's revenue,
 * so `paymentsTracked: false` makes the money tiles say so, and the revenue
 * delta is null whenever either window has no recorded payments or starts
 * before recording did (AN-07): a growth chip needs two comparable windows.
 *
 * No-show rate is NO_SHOW over resolved visits (COMPLETED + NO_SHOW), for
 * the daily line and the chip alike. Cancelled visits and today's patients
 * who have not come yet are not a «showed up» outcome, and counting them in
 * the denominator made the rate read lower than it is (AN-07).
 *
 * Period:
 *   ?period=week|month|quarter  (alias for fixed windows)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (explicit range, overrides period)
 *
 * DOCTOR role sees only their own slice (appointments + revenue filtered
 * by `doctor.userId === session.user.id`). ADMIN sees everything. The slice
 * is fail-closed (`doctor-scope.ts`, AN-06): a doctor login with no Doctor
 * row gets 403, never the clinic, and the clinic-wide sections (the LTV
 * distribution, patient sources) are narrowed or left out for a doctor.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import {
  type AnalyticsPeriod,
  eachDay,
  resolveAnalyticsRange,
  ymdKey,
} from "@/server/analytics/range";
import {
  isResolvedVisit,
  previousWindow,
  rateDeltaPp,
  revenueDeltaPct,
} from "@/server/analytics/period-compare";
import { averageLtv } from "@/server/analytics/ltv-summary";
import { loadClinicLoad } from "@/server/analytics/clinic-load";
import { resolveAnalyticsScope } from "@/server/analytics/doctor-scope";
import { paymentsRecordedSince } from "@/server/patient/finance";

export { resolveAnalyticsRange };
export type { AnalyticsPeriod };

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);

    const ctx = getTenant();
    // clinicId is interpolated into the raw LTV query below (the Prisma
    // tenant extension doesn't apply to $queryRawUnsafe), so a request with
    // no clinic stops here.
    if (!ctx || ctx.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }

    const scope = await resolveAnalyticsScope(ctx);
    if (scope.kind === "denied") {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }
    const doctorId = scope.kind === "doctor" ? scope.doctorId : null;
    const trackedSince = await paymentsRecordedSince(ctx.clinicId);
    const paymentsTracked = trackedSince !== null;

    // ----- 1. Revenue daily -------------------------------------------------
    const payments = await prisma.payment.findMany({
      where: {
        status: "PAID",
        paidAt: { gte: from, lt: to },
        ...(doctorId ? { appointment: { doctorId } } : {}),
      },
      select: {
        amount: true,
        paidAt: true,
        appointmentId: true,
        appointment: {
          select: { doctorId: true, serviceId: true },
        },
      },
    });

    const dailyMap = new Map<string, number>();
    for (const d of eachDay(from, to)) dailyMap.set(d, 0);
    for (const p of payments) {
      if (!p.paidAt) continue;
      const k = ymdKey(p.paidAt);
      dailyMap.set(k, (dailyMap.get(k) ?? 0) + p.amount);
    }
    const revenueDaily = [...dailyMap.entries()].map(([date, amount]) => ({
      date,
      amount,
    }));

    // ----- 2 + 3. Appointments by status AND no-show rate daily ------------
    // Single scan of the Appointment table covers both sections. The original
    // code ran a groupBy AND a findMany for the same date filter — two
    // round-trips, same rows. Now we do one findMany and derive both shapes
    // in memory (the per-row payload is two tiny columns, cheap to ship).
    const dailyAppts = await prisma.appointment.findMany({
      where: {
        date: { gte: from, lt: to },
        ...(doctorId ? { doctorId } : {}),
      },
      select: { date: true, status: true },
    });
    const statusTotals = new Map<string, number>();
    // `total` per day = resolved visits (COMPLETED + NO_SHOW), the no-show
    // rate's denominator; see the header.
    const totalMap = new Map<string, number>();
    const nsMap = new Map<string, number>();
    for (const d of eachDay(from, to)) {
      totalMap.set(d, 0);
      nsMap.set(d, 0);
    }
    for (const a of dailyAppts) {
      statusTotals.set(a.status, (statusTotals.get(a.status) ?? 0) + 1);
      if (!isResolvedVisit(a.status)) continue;
      const k = ymdKey(a.date);
      totalMap.set(k, (totalMap.get(k) ?? 0) + 1);
      if (a.status === "NO_SHOW") {
        nsMap.set(k, (nsMap.get(k) ?? 0) + 1);
      }
    }
    const appointmentsByStatus = [...statusTotals.entries()].map(
      ([status, count]) => ({ status, count }),
    );
    const noShowDaily = [...totalMap.entries()].map(([date, total]) => {
      const noShow = nsMap.get(date) ?? 0;
      return {
        date,
        total,
        noShow,
        rate: total > 0 ? noShow / total : 0,
      };
    });

    // ----- 3b. The previous window of equal length (UX-03) ----------------
    // Totals only, for the chips: revenue, visits and no-shows.
    const prev = previousWindow(from, to);
    const [prevPayments, prevByStatus, clinicLoad] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          status: "PAID",
          paidAt: { gte: prev.from, lt: prev.to },
          ...(doctorId ? { appointment: { doctorId } } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: {
          date: { gte: prev.from, lt: prev.to },
          ...(doctorId ? { doctorId } : {}),
        },
        _count: { _all: true },
      }),
      // «Динамика загрузки клиники»: booked minutes against the schedule's
      // working minutes, per day and for both windows (clinic-load.ts).
      loadClinicLoad(prisma, { from, to, previous: prev, doctorId }),
    ]);
    const revenueTotal = revenueDaily.reduce((a, d) => a + d.amount, 0);
    const noShowTotal = statusTotals.get("NO_SHOW") ?? 0;
    const resolvedTotal = (statusTotals.get("COMPLETED") ?? 0) + noShowTotal;
    let prevResolved = 0;
    let prevNoShow = 0;
    for (const g of prevByStatus as Array<{ status: string; _count: { _all: number } }>) {
      if (isResolvedVisit(g.status)) prevResolved += g._count._all;
      if (g.status === "NO_SHOW") prevNoShow += g._count._all;
    }
    const deltas = {
      revenuePct: revenueDeltaPct({
        trackedSince,
        current: { amount: revenueTotal, payments: payments.length },
        previous: { amount: prevPayments._sum.amount ?? 0, from: prev.from },
      }),
      noShowPp: rateDeltaPp(
        { part: noShowTotal, whole: resolvedTotal },
        { part: prevNoShow, whole: prevResolved },
      ),
      loadPp: rateDeltaPp(
        { part: clinicLoad.bookedMin, whole: clinicLoad.workingMin },
        {
          part: clinicLoad.previous.bookedMin,
          whole: clinicLoad.previous.workingMin,
        },
      ),
    };

    // ----- 4. Top doctors by revenue ---------------------------------------
    const revenueByDoctor = new Map<string, number>();
    const countByDoctor = new Map<string, number>();
    for (const p of payments) {
      const did = p.appointment?.doctorId;
      if (!did) continue;
      revenueByDoctor.set(did, (revenueByDoctor.get(did) ?? 0) + p.amount);
      countByDoctor.set(did, (countByDoctor.get(did) ?? 0) + 1);
    }
    const topDoctorIds = [...revenueByDoctor.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);
    const topDoctorsRows = topDoctorIds.length
      ? await prisma.doctor.findMany({
          where: { id: { in: topDoctorIds } },
          select: { id: true, nameRu: true, nameUz: true },
        })
      : [];
    const doctorById = new Map(topDoctorsRows.map((r) => [r.id, r] as const));
    const topDoctors = topDoctorIds.map((id) => {
      const d = doctorById.get(id);
      return {
        doctorId: id,
        name: d?.nameRu ?? id,
        nameUz: d?.nameUz ?? null,
        revenue: revenueByDoctor.get(id) ?? 0,
        count: countByDoctor.get(id) ?? 0,
      };
    });

    // ----- 5. Top services by count ----------------------------------------
    // Use AppointmentService join for multi-service appointments; fall back to primary.
    const apptServices = await prisma.appointmentService.findMany({
      where: {
        appointment: {
          date: { gte: from, lt: to },
          ...(doctorId ? { doctorId } : {}),
        },
      },
      select: { serviceId: true },
    });
    const serviceCount = new Map<string, number>();
    for (const s of apptServices) {
      serviceCount.set(s.serviceId, (serviceCount.get(s.serviceId) ?? 0) + 1);
    }
    // If the join is empty (some tenants only set primary), fall back.
    if (serviceCount.size === 0) {
      const primaries = await prisma.appointment.findMany({
        where: {
          date: { gte: from, lt: to },
          serviceId: { not: null },
          ...(doctorId ? { doctorId } : {}),
        },
        select: { serviceId: true },
      });
      for (const p of primaries) {
        if (!p.serviceId) continue;
        serviceCount.set(
          p.serviceId,
          (serviceCount.get(p.serviceId) ?? 0) + 1,
        );
      }
    }
    const topServiceIds = [...serviceCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);
    const topServiceRows = topServiceIds.length
      ? await prisma.service.findMany({
          where: { id: { in: topServiceIds } },
          select: { id: true, nameRu: true, nameUz: true },
        })
      : [];
    const serviceById = new Map(topServiceRows.map((r) => [r.id, r] as const));
    const topServices = topServiceIds.map((id) => {
      const s = serviceById.get(id);
      return {
        serviceId: id,
        name: s?.nameRu ?? id,
        nameUz: s?.nameUz ?? null,
        count: serviceCount.get(id) ?? 0,
      };
    });

    // ----- 6. Patient sources breakdown (new patients in range) -----------
    // A doctor sees the sources of their own patients only.
    const sourceGroups = await prisma.patient.groupBy({
      by: ["source"],
      where: {
        createdAt: { gte: from, lt: to },
        ...(doctorId ? { appointments: { some: { doctorId } } } : {}),
      },
      _count: { _all: true },
    });
    const sources = sourceGroups.map((g) => ({
      source: g.source ?? "OTHER",
      count: g._count._all,
    }));

    // ----- 7. LTV distribution (histogram, UZS tiyin) ---------------------
    // Buckets: 0, <500k, 500k-1m, 1-3m, 3-10m, 10m+
    //
    // Previously we did `prisma.patient.findMany({ select: { ltv: true } })`
    // and bucketed in JS — that pulls one row per patient into the API
    // process just to discard the integer after a comparison. With 10k+
    // patients per tenant in seed data alone, the round-trip dominated the
    // whole analytics dashboard. Push the bucketing to Postgres: one row,
    // six counts. Raw SQL because Prisma can't express CASE-conditional
    // aggregates without an extension.
    //
    // The average LTV is computed here too (AN-05). The browser used to
    // average bucket midpoints keyed "0-300k", "300k-600k"… while the buckets
    // are "0", "<500k"…, so every lookup fell back to 1 500 000 and the tile
    // read «1 500 000 сум» for any clinic. Null when no patient has paid
    // anything: an average of nothing is not zero.
    //
    // Patient LTV is the patient's payments to the whole clinic, colleagues'
    // visits included, so a doctor gets neither section.
    //
    // clinicId is interpolated via parameter to keep tenant scope strict
    // (the Prisma tenant extension doesn't apply to $queryRawUnsafe).
    const ltvAgg = doctorId
      ? null
      : (
          await prisma.$queryRawUnsafe<
            Array<{
              b0: bigint;
              b1: bigint;
              b2: bigint;
              b3: bigint;
              b4: bigint;
              b5: bigint;
              patients: bigint;
              ltvSum: bigint | null;
            }>
          >(
            `SELECT
               COUNT(*) FILTER (WHERE "ltv" = 0)                                        AS "b0",
               COUNT(*) FILTER (WHERE "ltv" >  0          AND "ltv" <=    50000000)     AS "b1",
               COUNT(*) FILTER (WHERE "ltv" >  50000000   AND "ltv" <=   100000000)     AS "b2",
               COUNT(*) FILTER (WHERE "ltv" > 100000000   AND "ltv" <=   300000000)     AS "b3",
               COUNT(*) FILTER (WHERE "ltv" > 300000000   AND "ltv" <=  1000000000)     AS "b4",
               COUNT(*) FILTER (WHERE "ltv" > 1000000000)                               AS "b5",
               COUNT(*)                                                                 AS "patients",
               SUM("ltv")::bigint                                                       AS "ltvSum"
             FROM "Patient"
             WHERE "clinicId" = $1
               AND "deletedAt" IS NULL`,
            ctx.clinicId,
          )
        )[0] ?? null;
    const ltvBuckets = ltvAgg
      ? [
          { bucket: "0", count: Number(ltvAgg.b0 ?? 0) },
          { bucket: "<500k", count: Number(ltvAgg.b1 ?? 0) },
          { bucket: "500k-1m", count: Number(ltvAgg.b2 ?? 0) },
          { bucket: "1m-3m", count: Number(ltvAgg.b3 ?? 0) },
          { bucket: "3m-10m", count: Number(ltvAgg.b4 ?? 0) },
          { bucket: "10m+", count: Number(ltvAgg.b5 ?? 0) },
        ]
      : [];
    const ltv = averageLtv(
      ltvAgg
        ? { patients: Number(ltvAgg.patients ?? 0), ltvSum: Number(ltvAgg.ltvSum ?? 0) }
        : null,
    );

    return ok({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      doctorOnly: Boolean(doctorId),
      paymentsTracked,
      revenueDaily,
      appointmentsByStatus,
      noShowDaily,
      topDoctors,
      topServices,
      sources,
      ltvBuckets,
      ltv,
      clinicLoad,
      deltas,
    });
  },
);
