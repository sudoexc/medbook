import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Phone, CreditCard, FileText, Banknote, ChevronDown } from "lucide-react";
import { getServicePrice, formatRevenue } from "@/lib/revenue";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const session = await auth();
  const { locale, id } = await params;

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      appointments: {
        include: {
          doctor: true,
          medicalRecord: true,
          payment: true,
        },
        orderBy: { date: "desc" },
      },
    },
  });

  if (!patient) notFound();

  const isRu = locale === "ru";

  const totalVisits = patient.appointments.filter((a) => a.queueStatus === "COMPLETED").length;
  const avgDuration = totalVisits > 0
    ? Math.round(
        patient.appointments
          .filter((a) => a.durationMin != null)
          .reduce((sum, a) => sum + (a.durationMin || 0), 0) /
        (patient.appointments.filter((a) => a.durationMin != null).length || 1)
      )
    : 0;

  const totalSpent = patient.appointments.reduce((sum, a) => {
    if (a.payment?.status === "PAID") return sum + a.payment.amount;
    return sum;
  }, 0);

  const totalDebt = patient.appointments.reduce((sum, a) => {
    if (a.payment?.status === "UNPAID") return sum + a.payment.amount;
    return sum;
  }, 0);

  const statusColors: Record<string, string> = {
    WAITING: "bg-amber-50 text-amber-700",
    IN_PROGRESS: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-green-50 text-green-700",
    SKIPPED: "bg-gray-50 text-gray-700",
    CANCELLED: "bg-red-50 text-red-700",
  };
  const statusLabels: Record<string, Record<string, string>> = {
    WAITING: { ru: "Ожидает", uz: "Kutilmoqda" },
    IN_PROGRESS: { ru: "На приёме", uz: "Qabulda" },
    COMPLETED: { ru: "Завершён", uz: "Tugallangan" },
    SKIPPED: { ru: "Пропущен", uz: "O'tkazildi" },
    CANCELLED: { ru: "Отменён", uz: "Bekor" },
  };

  const paymentMethodLabels: Record<string, Record<string, string>> = {
    CASH: { ru: "Наличные", uz: "Naqd" },
    CARD: { ru: "Карта", uz: "Karta" },
    TRANSFER: { ru: "Перевод", uz: "O'tkazma" },
  };

  return (
    <div className="space-y-6">
      <a
        href={`/${locale}/dashboard/patients`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {isRu ? "Все пациенты" : "Barcha bemorlar"}
      </a>

      {/* Patient card */}
      <div className="rounded-2xl border border-border/40 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
            {patient.fullName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold">{patient.fullName}</h1>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" /> {patient.phone}</span>
              {patient.passport && <span className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> {patient.passport}</span>}
            </div>
            {patient.notes && <p className="mt-3 text-sm text-muted-foreground">{patient.notes}</p>}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-secondary/50 p-3">
            <p className="text-xs text-muted-foreground">{isRu ? "Всего визитов" : "Jami tashriflar"}</p>
            <p className="text-lg font-bold mt-0.5">{totalVisits}</p>
          </div>
          <div className="rounded-xl bg-secondary/50 p-3">
            <p className="text-xs text-muted-foreground">{isRu ? "Ср. время приёма" : "O'rtacha vaqt"}</p>
            <p className="text-lg font-bold mt-0.5">{avgDuration} {isRu ? "мин" : "daq"}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-xs text-muted-foreground">{isRu ? "Оплачено" : "To'langan"}</p>
            <p className="text-lg font-bold mt-0.5 text-green-700">{formatRevenue(totalSpent)} <span className="text-xs font-normal">{isRu ? "сум" : "so'm"}</span></p>
          </div>
          {totalDebt > 0 && (
            <div className="rounded-xl bg-red-50 p-3">
              <p className="text-xs text-muted-foreground">{isRu ? "Задолженность" : "Qarzdorlik"}</p>
              <p className="text-lg font-bold mt-0.5 text-red-700">{formatRevenue(totalDebt)} <span className="text-xs font-normal">{isRu ? "сум" : "so'm"}</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Appointment history with EMR */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-border/40 px-6 py-4">
          <h2 className="text-lg font-semibold">{isRu ? "История приёмов" : "Qabullar tarixi"}</h2>
        </div>

        {patient.appointments.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground">
            {isRu ? "Приёмов пока нет" : "Hali qabullar yo'q"}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {patient.appointments.map((appt) => (
              <details key={appt.id} className="group">
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-secondary/20 transition-colors list-none">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-medium">
                          {appt.date.toLocaleDateString(isRu ? "ru-RU" : "uz-UZ", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                        <span className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-medium ${statusColors[appt.queueStatus] || ""}`}>
                          {statusLabels[appt.queueStatus]?.[locale] || appt.queueStatus}
                        </span>
                        {appt.payment && (
                          <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium ${
                            appt.payment.status === "PAID" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                          }`}>
                            <Banknote className="h-3 w-3" />
                            {formatRevenue(appt.payment.amount)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span>{isRu ? appt.doctor.nameRu : appt.doctor.nameUz}</span>
                        {appt.service && <span>• {appt.service}</span>}
                        {appt.durationMin != null && <span>• {appt.durationMin} {isRu ? "мин" : "daq"}</span>}
                      </div>
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
                </summary>

                <div className="px-6 pb-5 pt-1">
                  {/* Medical record */}
                  {appt.medicalRecord ? (
                    <div className="rounded-xl border border-border/40 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <FileText className="h-4 w-4" />
                        {isRu ? "Медицинская карта" : "Tibbiy karta"}
                      </div>
                      {appt.medicalRecord.complaints && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{isRu ? "Жалобы" : "Shikoyatlar"}</p>
                          <p className="text-sm mt-0.5">{appt.medicalRecord.complaints}</p>
                        </div>
                      )}
                      {appt.medicalRecord.diagnosis && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{isRu ? "Диагноз" : "Tashxis"}</p>
                          <p className="text-sm mt-0.5">{appt.medicalRecord.diagnosis}</p>
                        </div>
                      )}
                      {appt.medicalRecord.prescriptions && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{isRu ? "Назначения" : "Buyurmalar"}</p>
                          <p className="text-sm mt-0.5 whitespace-pre-wrap">{appt.medicalRecord.prescriptions}</p>
                        </div>
                      )}
                      {appt.medicalRecord.recommendations && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{isRu ? "Рекомендации" : "Tavsiyalar"}</p>
                          <p className="text-sm mt-0.5 whitespace-pre-wrap">{appt.medicalRecord.recommendations}</p>
                        </div>
                      )}
                    </div>
                  ) : appt.notes ? (
                    <div className="rounded-xl border border-border/40 p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">{isRu ? "Заметки" : "Eslatmalar"}</p>
                      <p className="text-sm whitespace-pre-wrap">{appt.notes}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {isRu ? "Нет записей по визиту" : "Tashrifga oid yozuvlar yo'q"}
                    </p>
                  )}

                  {/* Payment info */}
                  {appt.payment && (
                    <div className={`mt-3 rounded-xl p-3 flex items-center justify-between text-sm ${
                      appt.payment.status === "PAID" ? "bg-green-50" : "bg-red-50"
                    }`}>
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4" />
                        <span className="font-medium">{formatRevenue(appt.payment.amount)} {isRu ? "сум" : "so'm"}</span>
                        <span className="text-xs text-muted-foreground">
                          {paymentMethodLabels[appt.payment.method]?.[locale] || appt.payment.method}
                        </span>
                      </div>
                      <span className={`text-xs font-medium ${
                        appt.payment.status === "PAID" ? "text-green-700" : "text-red-700"
                      }`}>
                        {appt.payment.status === "PAID" ? (isRu ? "Оплачено" : "To'langan") : (isRu ? "Не оплачено" : "To'lanmagan")}
                      </span>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
