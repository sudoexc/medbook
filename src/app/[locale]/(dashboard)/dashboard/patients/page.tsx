import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PatientSearch } from "./search";

export default async function PatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  const { locale } = await params;
  const { q } = await searchParams;

  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const where = q && q.length >= 2
    ? {
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { passport: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const patients = await prisma.patient.findMany({
    where,
    include: {
      _count: { select: { appointments: true } },
      appointments: { orderBy: { date: "desc" }, take: 1, select: { date: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const isRu = locale === "ru";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {isRu ? "База пациентов" : "Bemorlar bazasi"}
      </h1>

      <PatientSearch locale={locale} defaultValue={q || ""} />

      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30">
                <th className="px-6 py-3.5 text-left font-semibold">{isRu ? "ФИО" : "Ism"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{isRu ? "Телефон" : "Telefon"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{isRu ? "Паспорт" : "Pasport"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{isRu ? "Визитов" : "Tashriflar"}</th>
                <th className="px-6 py-3.5 text-left font-semibold">{isRu ? "Последний" : "Oxirgi"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {patients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    {isRu ? "Пациентов не найдено" : "Bemorlar topilmadi"}
                  </td>
                </tr>
              ) : (
                patients.map((p) => (
                  <tr key={p.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4">
                      <a href={`/${locale}/dashboard/patients/${p.id}`} className="font-medium hover:text-primary transition-colors">
                        {p.fullName}
                      </a>
                    </td>
                    <td className="px-6 py-4">{p.phone}</td>
                    <td className="px-6 py-4 text-muted-foreground">{p.passport || "—"}</td>
                    <td className="px-6 py-4">{p._count.appointments}</td>
                    <td className="px-6 py-4 text-muted-foreground text-xs">
                      {p.appointments[0]
                        ? p.appointments[0].date.toLocaleDateString(isRu ? "ru-RU" : "uz-UZ")
                        : "—"}
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
