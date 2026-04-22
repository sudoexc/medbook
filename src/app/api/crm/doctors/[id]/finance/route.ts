/**
 * /api/crm/doctors/[id]/finance — revenue + bonus for a doctor in a date range.
 * See docs/TZ.md §6.6, §10.Фаза-2d.
 * bonus = Σ(priceFinal for COMPLETED appointments in range) * salaryPercent / 100
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound, forbidden, parseQuery } from "@/server/http";
import { DateRangeSchema } from "@/server/schemas/common";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const doctorId = idFromUrl(request);
    const parsed = parseQuery(request, DateRangeSchema);
    if (!parsed.ok) return parsed.response;
    const { from, to } = parsed.value;

    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;

    const completed = await prisma.appointment.aggregate({
      where: {
        doctorId,
        status: "COMPLETED",
        ...(from || to ? { date: dateFilter } : {}),
      },
      _sum: { priceFinal: true },
      _count: { _all: true },
    });

    const revenue = completed._sum.priceFinal ?? 0;
    const bonus = Math.round((revenue * doctor.salaryPercent) / 100);
    return ok({
      doctorId,
      period: { from: from ?? null, to: to ?? null },
      revenue,
      appointments: completed._count._all,
      salaryPercent: doctor.salaryPercent,
      bonus,
    });
  }
);
