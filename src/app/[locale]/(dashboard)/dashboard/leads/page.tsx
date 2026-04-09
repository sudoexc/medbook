import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getDoctors } from "@/lib/doctors";
import { LeadsTable } from "./leads-table";

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

  const role = session.user.role;
  const doctorId = session.user.doctorId;

  // ADMIN and RECEPTIONIST see all leads; DOCTOR sees only their own
  const whereClause =
    role === "ADMIN" || role === "RECEPTIONIST"
      ? {}
      : { doctorId: doctorId || undefined };

  const [leads, doctors] = await Promise.all([
    prisma.lead.findMany({
      where: whereClause,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    getDoctors(),
  ]);

  const canBook = role === "ADMIN" || role === "RECEPTIONIST";

  return (
    <LeadsTable
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        doctorId: l.doctorId,
        service: l.service,
        date: l.date,
        status: l.status,
        createdAt: l.createdAt.toISOString(),
      }))}
      doctors={doctors}
      locale={locale as "ru" | "uz"}
      canBook={canBook}
    />
  );
}
