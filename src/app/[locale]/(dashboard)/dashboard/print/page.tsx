import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { formatRevenue } from "@/lib/revenue";
import { AutoPrint } from "@/components/auto-print";

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const session = await auth();
  const { locale } = await params;
  const { type, id } = await searchParams;

  if (!session?.user) redirect(`/${locale}/login`);
  if (!type || !id) return <p>Missing parameters</p>;

  const isRu = locale === "ru";

  if (type === "receipt") {
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { appointment: { include: { patient: true, doctor: true } } },
    });
    if (!payment) return <p>Not found</p>;

    const methodLabels: Record<string, string> = {
      CASH: isRu ? "Наличные" : "Naqd",
      CARD: isRu ? "Карта" : "Karta",
      TRANSFER: isRu ? "Перевод" : "O'tkazma",
    };

    return (
      <div className="max-w-md mx-auto p-8 font-sans text-sm print:p-4">
        <style>{`@media print { body { margin: 0; } @page { size: 80mm auto; margin: 5mm; } }`}</style>
        <div className="text-center border-b pb-4 mb-4">
          <h1 className="text-lg font-bold">NeuroFax-B</h1>
          <p className="text-xs text-gray-500">{isRu ? "Диагностический центр" : "Diagnostika markazi"}</p>
          <p className="text-xs text-gray-500">г. Ташкент</p>
        </div>

        <div className="text-center mb-4">
          <p className="font-bold text-base">{isRu ? "КВИТАНЦИЯ" : "KVITANSIYA"}</p>
          <p className="text-xs text-gray-500">
            {payment.createdAt.toLocaleDateString(isRu ? "ru-RU" : "uz-UZ")} {payment.createdAt.toLocaleTimeString(isRu ? "ru-RU" : "uz-UZ", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        <table className="w-full text-sm mb-4">
          <tbody>
            <tr><td className="py-1 text-gray-500">{isRu ? "Пациент" : "Bemor"}:</td><td className="py-1 font-medium text-right">{payment.appointment.patient.fullName}</td></tr>
            <tr><td className="py-1 text-gray-500">{isRu ? "Врач" : "Shifokor"}:</td><td className="py-1 text-right">{isRu ? payment.appointment.doctor.nameRu : payment.appointment.doctor.nameUz}</td></tr>
            {payment.appointment.service && (
              <tr><td className="py-1 text-gray-500">{isRu ? "Услуга" : "Xizmat"}:</td><td className="py-1 text-right">{payment.appointment.service}</td></tr>
            )}
          </tbody>
        </table>

        <div className="border-t border-b py-3 my-3 flex justify-between items-center">
          <span className="font-bold text-base">{isRu ? "ИТОГО" : "JAMI"}:</span>
          <span className="font-bold text-lg">{formatRevenue(payment.amount)} {isRu ? "сум" : "so'm"}</span>
        </div>

        <div className="text-sm mb-4">
          <div className="flex justify-between"><span className="text-gray-500">{isRu ? "Способ оплаты" : "To'lov usuli"}:</span><span>{methodLabels[payment.method]}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">{isRu ? "Статус" : "Status"}:</span><span className={payment.status === "PAID" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{payment.status === "PAID" ? (isRu ? "Оплачено" : "To'langan") : (isRu ? "Не оплачено" : "To'lanmagan")}</span></div>
        </div>

        <div className="text-center text-xs text-gray-400 border-t pt-4">
          <p>{isRu ? "Спасибо за визит!" : "Tashrifingiz uchun rahmat!"}</p>
          <p>+998 71 200 00 07 | neurofax.uz</p>
        </div>

        <AutoPrint />
      </div>
    );
  }

  if (type === "prescription") {
    const record = await prisma.medicalRecord.findUnique({
      where: { id },
      include: { appointment: { include: { patient: true, doctor: true } } },
    });
    if (!record) return <p>Not found</p>;

    return (
      <div className="max-w-2xl mx-auto p-8 font-sans text-sm print:p-6">
        <style>{`@media print { body { margin: 0; } @page { size: A5; margin: 10mm; } }`}</style>
        <div className="flex items-center justify-between border-b pb-4 mb-6">
          <div>
            <h1 className="text-xl font-bold">NeuroFax-B</h1>
            <p className="text-xs text-gray-500">{isRu ? "Диагностический центр" : "Diagnostika markazi"}</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>{record.appointment.date.toLocaleDateString(isRu ? "ru-RU" : "uz-UZ")}</p>
            <p>г. Ташкент</p>
          </div>
        </div>

        <div className="mb-6">
          <p><span className="text-gray-500">{isRu ? "Пациент" : "Bemor"}:</span> <strong>{record.appointment.patient.fullName}</strong></p>
          <p><span className="text-gray-500">{isRu ? "Врач" : "Shifokor"}:</span> {isRu ? record.appointment.doctor.nameRu : record.appointment.doctor.nameUz}</p>
        </div>

        {record.complaints && (
          <div className="mb-4">
            <h3 className="font-semibold text-sm border-b pb-1 mb-2">{isRu ? "Жалобы" : "Shikoyatlar"}</h3>
            <p className="whitespace-pre-wrap">{record.complaints}</p>
          </div>
        )}

        {record.diagnosis && (
          <div className="mb-4">
            <h3 className="font-semibold text-sm border-b pb-1 mb-2">{isRu ? "Диагноз" : "Tashxis"}</h3>
            <p className="whitespace-pre-wrap">{record.diagnosis}</p>
          </div>
        )}

        {record.prescriptions && (
          <div className="mb-4">
            <h3 className="font-semibold text-sm border-b pb-1 mb-2">{isRu ? "Назначения" : "Buyurmalar"}</h3>
            <p className="whitespace-pre-wrap">{record.prescriptions}</p>
          </div>
        )}

        {record.recommendations && (
          <div className="mb-4">
            <h3 className="font-semibold text-sm border-b pb-1 mb-2">{isRu ? "Рекомендации" : "Tavsiyalar"}</h3>
            <p className="whitespace-pre-wrap">{record.recommendations}</p>
          </div>
        )}

        <div className="mt-12 flex justify-between text-xs text-gray-400">
          <p>{isRu ? "Подпись врача: _______________" : "Shifokor imzosi: _______________"}</p>
          <p>{isRu ? "Печать" : "Muhr"}</p>
        </div>

        <AutoPrint />
      </div>
    );
  }

  return <p>Unknown print type</p>;
}
