import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Escape a value for safe CSV output.
 * - Wraps in double quotes
 * - Doubles internal double quotes
 * - Prefixes with "'" if it starts with a CSV-formula trigger char to defeat
 *   formula injection in Excel/Google Sheets (=, +, -, @, tab, CR).
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function csvRow(...cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\n";
}

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
      select: {
        amount: true,
        method: true,
        status: true,
        appointment: {
          select: {
            date: true,
            service: true,
            patient: { select: { fullName: true, phone: true } },
            doctor: { select: { nameRu: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    csv = csvRow("Дата", "Пациент", "Телефон", "Врач", "Услуга", "Сумма", "Способ", "Статус");
    for (const p of payments) {
      csv += csvRow(
        p.appointment.date.toLocaleDateString("ru-RU"),
        p.appointment.patient.fullName,
        p.appointment.patient.phone,
        p.appointment.doctor.nameRu,
        p.appointment.service || "",
        p.amount,
        p.method,
        p.status,
      );
    }
  } else if (type === "patients") {
    const patients = await prisma.patient.findMany({
      select: {
        fullName: true,
        phone: true,
        passport: true,
        createdAt: true,
        _count: { select: { appointments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    csv = csvRow("ФИО", "Телефон", "Паспорт", "Визитов", "Дата регистрации");
    for (const p of patients) {
      csv += csvRow(
        p.fullName,
        p.phone,
        p.passport || "",
        p._count.appointments,
        p.createdAt.toLocaleDateString("ru-RU"),
      );
    }
  } else if (type === "appointments") {
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        ...(doctorId ? { doctorId } : {}),
      },
      select: {
        date: true,
        service: true,
        queueStatus: true,
        durationMin: true,
        patient: { select: { fullName: true, phone: true } },
        doctor: { select: { nameRu: true } },
      },
      orderBy: { date: "desc" },
      take: 10000,
    });

    csv = csvRow("Дата", "Время", "Пациент", "Телефон", "Врач", "Услуга", "Статус", "Длительность");
    for (const a of appointments) {
      const time = a.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      csv += csvRow(
        a.date.toLocaleDateString("ru-RU"),
        time,
        a.patient.fullName,
        a.patient.phone,
        a.doctor.nameRu,
        a.service || "",
        a.queueStatus,
        a.durationMin ?? "",
      );
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
