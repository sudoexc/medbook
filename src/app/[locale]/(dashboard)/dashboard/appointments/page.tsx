import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AppointmentStatusUpdate } from "./status-update";

export default async function AppointmentsPage({
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
  const whereClause = role === "ADMIN" ? {} : { doctorId: doctorId || undefined };

  const appointments = await prisma.appointment.findMany({
    where: whereClause,
    include: { doctor: true, patient: true },
    orderBy: { date: "desc" },
  });

  const statusLabels: Record<string, Record<string, string>> = {
    WAITING: { ru: "Ожидает", uz: "Kutilmoqda" },
    IN_PROGRESS: { ru: "На приёме", uz: "Qabulda" },
    COMPLETED: { ru: "Завершена", uz: "Tugallangan" },
    SKIPPED: { ru: "Пропущена", uz: "O'tkazildi" },
    CANCELLED: { ru: "Отменена", uz: "Bekor qilindi" },
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {locale === "ru" ? "Записи на приём" : "Qabulga yozilishlar"}
      </h1>

      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30">
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Пациент" : "Bemor"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Телефон" : "Telefon"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Врач" : "Shifokor"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Услуга" : "Xizmat"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Дата" : "Sana"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Статус" : "Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {appointments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    {locale === "ru" ? "Записей пока нет" : "Hali yozilishlar yo'q"}
                  </td>
                </tr>
              ) : (
                appointments.map((appt) => (
                  <tr key={appt.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4 font-medium">{appt.patient.fullName}</td>
                    <td className="px-6 py-4">{appt.patient.phone}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {locale === "ru" ? appt.doctor.nameRu : appt.doctor.nameUz}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{appt.service || "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {appt.date.toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")}
                    </td>
                    <td className="px-6 py-4">
                      <AppointmentStatusUpdate
                        appointmentId={appt.id}
                        currentStatus={appt.queueStatus}
                        statusLabels={statusLabels}
                        locale={locale}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
