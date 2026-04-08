import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { LeadStatusUpdate } from "./status-update";

export default async function LeadsPage({
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

  const leads = await prisma.lead.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
  });

  const statusLabels: Record<string, Record<string, string>> = {
    NEW: { ru: "Новая", uz: "Yangi" },
    CONTACTED: { ru: "На связи", uz: "Bog'lanildi" },
    CONVERTED: { ru: "Конвертирована", uz: "Konvertatsiya" },
    CANCELLED: { ru: "Отменена", uz: "Bekor qilindi" },
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {locale === "ru" ? "Все заявки" : "Barcha so'rovlar"}
      </h1>

      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30">
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Имя" : "Ism"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Телефон" : "Telefon"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Услуга" : "Xizmat"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Дата" : "Sana"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Статус" : "Status"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{locale === "ru" ? "Создана" : "Yaratilgan"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    {locale === "ru" ? "Заявок пока нет" : "Hali so'rovlar yo'q"}
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4 font-medium">{lead.name}</td>
                    <td className="px-6 py-4">{lead.phone}</td>
                    <td className="px-6 py-4 text-muted-foreground">{lead.service || "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground">{lead.date || "—"}</td>
                    <td className="px-6 py-4">
                      <LeadStatusUpdate
                        leadId={lead.id}
                        currentStatus={lead.status}
                        statusLabels={statusLabels}
                        locale={locale}
                      />
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-xs">
                      {lead.createdAt.toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")}
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
