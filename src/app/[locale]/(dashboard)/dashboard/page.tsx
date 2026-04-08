import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Users, Clock, ListOrdered, Activity, Banknote, ArrowRight } from "lucide-react";
import { getServicePrice, formatRevenue } from "@/lib/revenue";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const session = await auth();
  const { locale } = await params;

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const doctorId = session.user.doctorId;
  const role = session.user.role;
  const isRu = locale === "ru";
  const isAdmin = role === "ADMIN";

  // Date ranges
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const whereClause = isAdmin ? {} : { doctorId: doctorId || undefined };
  const queueFilter = { ...whereClause, date: { gte: today, lt: tomorrow } };

  const [totalLeads, newLeads, inQueue, seenToday, todayCompleted, monthCompleted] = await Promise.all([
    prisma.lead.count({ where: whereClause }),
    prisma.lead.count({ where: { ...whereClause, status: "NEW" } }),
    prisma.appointment.count({ where: { ...queueFilter, queueStatus: { in: ["WAITING", "IN_PROGRESS"] } } }),
    prisma.appointment.count({ where: { ...queueFilter, queueStatus: "COMPLETED" } }),
    prisma.appointment.findMany({
      where: { ...queueFilter, queueStatus: "COMPLETED" },
      include: { doctor: true },
    }),
    prisma.appointment.findMany({
      where: { ...whereClause, queueStatus: "COMPLETED", completedAt: { gte: monthStart } },
      include: { doctor: true },
    }),
  ]);

  // Revenue calculations
  const revenueToday = todayCompleted.reduce((s, a) => s + getServicePrice(a.service, a.doctor.services), 0);
  const revenueMonth = monthCompleted.reduce((s, a) => s + getServicePrice(a.service, a.doctor.services), 0);

  // Upcoming appointments (for doctor view)
  const upcoming = !isAdmin
    ? await prisma.appointment.findMany({
        where: { doctorId: doctorId || undefined, date: { gte: today, lt: tomorrow }, queueStatus: "WAITING" },
        include: { patient: true },
        orderBy: { date: "asc" },
        take: 5,
      })
    : [];

  // Current patient
  const currentPatient = !isAdmin
    ? await prisma.appointment.findFirst({
        where: { doctorId: doctorId || undefined, date: { gte: today, lt: tomorrow }, queueStatus: "IN_PROGRESS" },
        include: { patient: true },
      })
    : null;

  // Recent leads
  const recentLeads = await prisma.lead.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const stats = [
    { label: isRu ? "В очереди" : "Navbatda", value: inQueue, icon: ListOrdered, color: "text-orange-600 bg-orange-50" },
    { label: isRu ? "Принято сегодня" : "Bugun qabul", value: seenToday, icon: Activity, color: "text-green-600 bg-green-50" },
    { label: isRu ? "Выручка сегодня" : "Bugungi daromad", value: `${formatRevenue(revenueToday)}`, icon: Banknote, color: "text-emerald-600 bg-emerald-50", suffix: isRu ? " сум" : " so'm" },
    { label: isRu ? "Выручка за месяц" : "Oylik daromad", value: `${formatRevenue(revenueMonth)}`, icon: Banknote, color: "text-purple-600 bg-purple-50", suffix: isRu ? " сум" : " so'm" },
    { label: isRu ? "Новые заявки" : "Yangi so'rovlar", value: newLeads, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: isRu ? "Всего заявок" : "Jami so'rovlar", value: totalLeads, icon: Users, color: "text-blue-600 bg-blue-50" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">
          {isRu ? "Панель управления" : "Boshqaruv paneli"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isRu
            ? `Добро пожаловать, ${session.user.name || session.user.email}`
            : `Xush kelibsiz, ${session.user.name || session.user.email}`}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">
                  {stat.value}{"suffix" in stat ? (stat as { suffix: string }).suffix : ""}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Doctor-specific: current patient + upcoming */}
      {!isAdmin && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Current patient */}
          <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-6">
            <p className="text-sm font-medium text-primary mb-3">
              {isRu ? "Текущий пациент" : "Hozirgi bemor"}
            </p>
            {currentPatient ? (
              <div>
                <p className="text-xl font-bold">{currentPatient.patient.fullName}</p>
                <p className="text-sm text-muted-foreground mt-1">{currentPatient.patient.phone}</p>
                <a
                  href={`/${locale}/dashboard/queue`}
                  className="mt-3 inline-flex items-center gap-1 text-sm text-primary font-medium hover:underline"
                >
                  {isRu ? "Перейти в очередь" : "Navbatga o'tish"} <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {isRu ? "Никого на приёме" : "Qabulda hech kim yo'q"}
              </p>
            )}
          </div>

          {/* Upcoming */}
          <div className="rounded-2xl border border-border/40 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">
                {isRu ? "Ожидают приёма" : "Qabulni kutmoqda"}
              </p>
              <a href={`/${locale}/dashboard/queue`} className="text-xs text-primary hover:underline">
                {isRu ? "Все" : "Hammasi"} →
              </a>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{isRu ? "Очередь пуста" : "Navbat bo'sh"}</p>
            ) : (
              <div className="space-y-3">
                {upcoming.map((appt, i) => (
                  <div key={appt.id} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{appt.patient.fullName}</p>
                      <p className="text-xs text-muted-foreground">{appt.patient.phone}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent leads */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
          <h2 className="text-lg font-semibold">
            {isRu ? "Последние заявки" : "Oxirgi so'rovlar"}
          </h2>
          <a href={`/${locale}/dashboard/leads`} className="text-xs text-primary hover:underline">
            {isRu ? "Все заявки" : "Barcha so'rovlar"} →
          </a>
        </div>
        {recentLeads.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground">
            {isRu ? "Заявок пока нет" : "Hali so'rovlar yo'q"}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="font-medium">{lead.name}</p>
                  <p className="text-sm text-muted-foreground">{lead.phone}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${
                    lead.status === "NEW" ? "bg-amber-50 text-amber-700"
                    : lead.status === "CONTACTED" ? "bg-blue-50 text-blue-700"
                    : lead.status === "CONVERTED" ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                  }`}>
                    {lead.status}
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">
                    {lead.createdAt.toLocaleDateString(isRu ? "ru-RU" : "uz-UZ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
