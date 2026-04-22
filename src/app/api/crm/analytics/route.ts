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
 *
 * Period:
 *   ?period=week|month|quarter  (alias for fixed windows)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (explicit range, overrides period)
 *
 * DOCTOR role sees only their own slice (appointments + revenue filtered
 * by `doctor.userId === session.user.id`). ADMIN sees everything.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import {
  type AnalyticsPeriod,
  eachDay,
  resolveAnalyticsRange,
  ymdKey,
} from "@/server/analytics/range";

export { resolveAnalyticsRange };
export type { AnalyticsPeriod };

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);

    const ctx = getTenant();
    const userId =
      ctx?.kind === "TENANT" && ctx.role === "DOCTOR" ? ctx.userId : null;

    // For DOCTOR scope, fetch the doctor row tied to this user once.
    const doctorFilter = userId
      ? await prisma.doctor.findFirst({
          where: { userId },
          select: { id: true },
        })
      : null;
    const doctorId = doctorFilter?.id ?? null;

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

    // ----- 2. Appointments by status ---------------------------------------
    const statusGroups = await prisma.appointment.groupBy({
      by: ["status"],
      where: {
        date: { gte: from, lt: to },
        ...(doctorId ? { doctorId } : {}),
      },
      _count: { _all: true },
    });
    const appointmentsByStatus = statusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    }));

    // ----- 3. No-show rate daily -------------------------------------------
    const dailyAppts = await prisma.appointment.findMany({
      where: {
        date: { gte: from, lt: to },
        ...(doctorId ? { doctorId } : {}),
      },
      select: { date: true, status: true },
    });
    const totalMap = new Map<string, number>();
    const nsMap = new Map<string, number>();
    for (const d of eachDay(from, to)) {
      totalMap.set(d, 0);
      nsMap.set(d, 0);
    }
    for (const a of dailyAppts) {
      const k = ymdKey(a.date);
      totalMap.set(k, (totalMap.get(k) ?? 0) + 1);
      if (a.status === "NO_SHOW") {
        nsMap.set(k, (nsMap.get(k) ?? 0) + 1);
      }
    }
    const noShowDaily = [...totalMap.entries()].map(([date, total]) => {
      const noShow = nsMap.get(date) ?? 0;
      return {
        date,
        total,
        noShow,
        rate: total > 0 ? noShow / total : 0,
      };
    });

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
    const topDoctors = topDoctorIds.map((id) => {
      const d = topDoctorsRows.find((r) => r.id === id);
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
    const topServices = topServiceIds.map((id) => {
      const s = topServiceRows.find((r) => r.id === id);
      return {
        serviceId: id,
        name: s?.nameRu ?? id,
        nameUz: s?.nameUz ?? null,
        count: serviceCount.get(id) ?? 0,
      };
    });

    // ----- 6. Patient sources breakdown (new patients in range) -----------
    const sourceGroups = await prisma.patient.groupBy({
      by: ["source"],
      where: {
        createdAt: { gte: from, lt: to },
      },
      _count: { _all: true },
    });
    const sources = sourceGroups.map((g) => ({
      source: g.source ?? "OTHER",
      count: g._count._all,
    }));

    // ----- 7. LTV distribution (histogram, UZS tiyin) ---------------------
    // Buckets: 0, <500k, 500k-1m, 1-3m, 3-10m, 10m+
    const ltvRows = await prisma.patient.findMany({
      select: { ltv: true },
    });
    const ltvBucketsDef: { bucket: string; max: number }[] = [
      { bucket: "0", max: 0 },
      { bucket: "<500k", max: 500_000_00 },
      { bucket: "500k-1m", max: 1_000_000_00 },
      { bucket: "1m-3m", max: 3_000_000_00 },
      { bucket: "3m-10m", max: 10_000_000_00 },
      { bucket: "10m+", max: Infinity },
    ];
    const ltvBuckets = ltvBucketsDef.map((b) => ({ bucket: b.bucket, count: 0 }));
    for (const r of ltvRows) {
      const v = r.ltv ?? 0;
      if (v === 0) {
        ltvBuckets[0]!.count += 1;
        continue;
      }
      for (let i = 1; i < ltvBucketsDef.length; i += 1) {
        const def = ltvBucketsDef[i]!;
        if (v <= def.max) {
          ltvBuckets[i]!.count += 1;
          break;
        }
      }
    }

    return ok({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      doctorOnly: Boolean(doctorId),
      revenueDaily,
      appointmentsByStatus,
      noShowDaily,
      topDoctors,
      topServices,
      sources,
      ltvBuckets,
    });
  },
);
