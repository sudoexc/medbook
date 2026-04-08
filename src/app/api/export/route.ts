import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServicePrice } from "@/lib/revenue";

// GET /api/export?type=payments|patients|appointments&from=&to=&doctorId=
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "RECEPTIONIST")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "payments";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const doctorId = url.searchParams.get("doctorId");

  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to + "T23:59:59") } : {}),
  };

  let csv = "";
  const fileName = `neurofax-${type}-${new Date().toISOString().split("T")[0]}.csv`;

  if (type === "payments") {
    const payments = await prisma.payment.findMany({
      where: {
        ...(Object.keys(dateFilter).length > 0 ? { appointment: { date: dateFilter } } : {}),
        ...(doctorId ? { appointment: { doctorId } } : {}),
      },
      include: { appointment: { include: { patient: true, doctor: true } } },
      orderBy: { createdAt: "desc" },
    });

    csv = "Дата,Пациент,Телефон,Врач,Услуга,Сумма,Способ,Статус\n";
    for (const p of payments) {
      csv += `${p.appointment.date.toLocaleDateString("ru-RU")},"${p.appointment.patient.fullName}",${p.appointment.patient.phone},"${p.appointment.doctor.nameRu}","${p.appointment.service || ""}",${p.amount},${p.method},${p.status}\n`;
    }
  } else if (type === "patients") {
    const patients = await prisma.patient.findMany({
      include: { _count: { select: { appointments: true } } },
      orderBy: { createdAt: "desc" },
    });

    csv = "ФИО,Телефон,Паспорт,Визитов,Дата регистрации\n";
    for (const p of patients) {
      csv += `"${p.fullName}",${p.phone},${p.passport || ""},${p._count.appointments},${p.createdAt.toLocaleDateString("ru-RU")}\n`;
    }
  } else if (type === "appointments") {
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        ...(doctorId ? { doctorId } : {}),
      },
      include: { patient: true, doctor: true },
      orderBy: { date: "desc" },
    });

    csv = "Дата,Время,Пациент,Телефон,Врач,Услуга,Статус,Длительность\n";
    for (const a of appointments) {
      const time = a.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      csv += `${a.date.toLocaleDateString("ru-RU")},${time},"${a.patient.fullName}",${a.patient.phone},"${a.doctor.nameRu}","${a.service || ""}",${a.queueStatus},${a.durationMin || ""}\n`;
    }
  }

  // BOM for Excel UTF-8 compatibility
  const bom = "\uFEFF";

  return new Response(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
