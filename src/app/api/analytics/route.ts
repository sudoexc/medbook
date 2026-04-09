import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServicePrice } from "@/lib/revenue";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const periodRaw = Number(url.searchParams.get("period"));
  // Clamp to a sensible range — prevents accidental/malicious huge windows that
  // would scan the entire appointments table.
  const days = Number.isFinite(periodRaw) && periodRaw > 0
    ? Math.min(Math.floor(periodRaw), 365)
    : 30;
  const filterDoctorId = url.searchParams.get("doctorId");

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days);

  const doctorFilter =
    session.user.role === "ADMIN"
      ? filterDoctorId ? { doctorId: filterDoctorId } : {}
      : { doctorId: session.user.doctorId || undefined };

  const appointments = await prisma.appointment.findMany({
    where: {
      ...doctorFilter,
      queueStatus: "COMPLETED",
      completedAt: { gte: since },
    },
    select: {
      startedAt: true,
      completedAt: true,
      date: true,
      service: true,
      durationMin: true,
      patientId: true,
      doctorId: true,
      doctor: { select: { nameRu: true, services: true } },
    },
    orderBy: { completedAt: "asc" },
    take: 5000,
  });

  // Hourly flow
  const hourlyMap = new Map<number, number>();
  for (let h = 8; h <= 17; h++) hourlyMap.set(h, 0);
  for (const a of appointments) {
    if (a.startedAt) {
      const h = a.startedAt.getHours();
      hourlyMap.set(h, (hourlyMap.get(h) || 0) + 1);
    }
  }
  const hourlyFlow = [...hourlyMap.entries()].map(([hour, count]) => ({ hour, count }));

  // Daily aggregations
  const dailyMap = new Map<string, { count: number; revenue: number; totalDuration: number; durationCount: number }>();

  for (const a of appointments) {
    const dateKey = (a.completedAt || a.date).toISOString().split("T")[0];
    const entry = dailyMap.get(dateKey) || { count: 0, revenue: 0, totalDuration: 0, durationCount: 0 };
    entry.count++;
    entry.revenue += getServicePrice(a.service, a.doctor.services);
    if (a.durationMin != null) {
      entry.totalDuration += a.durationMin;
      entry.durationCount++;
    }
    dailyMap.set(dateKey, entry);
  }

  // Fill in missing days with zeros
  const dailyRevenue: { date: string; revenue: number }[] = [];
  const dailyPatients: { date: string; count: number }[] = [];
  const dailyAvgDuration: { date: string; avg: number }[] = [];

  const cursor = new Date(since);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  while (cursor <= today) {
    const key = cursor.toISOString().split("T")[0];
    const entry = dailyMap.get(key);
    dailyRevenue.push({ date: key, revenue: entry?.revenue || 0 });
    dailyPatients.push({ date: key, count: entry?.count || 0 });
    dailyAvgDuration.push({
      date: key,
      avg: entry && entry.durationCount > 0 ? Math.round(entry.totalDuration / entry.durationCount) : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Service distribution
  const serviceMap = new Map<string, { count: number; revenue: number }>();
  for (const a of appointments) {
    const svc = a.service || "—";
    const entry = serviceMap.get(svc) || { count: 0, revenue: 0 };
    entry.count++;
    entry.revenue += getServicePrice(a.service, a.doctor.services);
    serviceMap.set(svc, entry);
  }
  const serviceDistribution = [...serviceMap.entries()]
    .map(([service, data]) => ({ service, ...data }))
    .sort((a, b) => b.count - a.count);

  // Summary
  const uniquePatientIds = new Set(appointments.map((a) => a.patientId));
  const withDuration = appointments.filter((a) => a.durationMin != null);
  const totalRevenue = appointments.reduce((s, a) => s + getServicePrice(a.service, a.doctor.services), 0);

  // Revenue by doctor
  const revenueByDoc = new Map<string, { name: string; revenue: number; count: number }>();
  for (const a of appointments) {
    const name = a.doctor.nameRu;
    const entry = revenueByDoc.get(a.doctorId) || { name, revenue: 0, count: 0 };
    entry.revenue += getServicePrice(a.service, a.doctor.services);
    entry.count++;
    revenueByDoc.set(a.doctorId, entry);
  }

  // Workload heatmap (last 12 weeks)
  const heatmap: { date: string; count: number }[] = [];
  const heatStart = new Date();
  heatStart.setDate(heatStart.getDate() - 84); // 12 weeks
  const heatCursor = new Date(heatStart);
  while (heatCursor <= today) {
    const key = heatCursor.toISOString().split("T")[0];
    heatmap.push({ date: key, count: dailyMap.get(key)?.count || 0 });
    heatCursor.setDate(heatCursor.getDate() + 1);
  }

  return Response.json({
    hourlyFlow,
    dailyRevenue,
    dailyPatients,
    dailyAvgDuration,
    serviceDistribution,
    heatmap,
    summary: {
      totalAppointments: appointments.length,
      uniquePatients: uniquePatientIds.size,
      avgDuration: withDuration.length > 0
        ? Math.round(withDuration.reduce((s, a) => s + (a.durationMin || 0), 0) / withDuration.length)
        : 0,
      totalRevenue,
      revenueByDoctor: [...revenueByDoc.entries()].map(([id, d]) => ({
        doctorId: id,
        name: d.name,
        revenue: d.revenue,
        count: d.count,
      })),
    },
  });
}
