/**
 * /api/crm/doctors/[id]/case-stats — MedicalCase metrics for a single doctor.
 *
 * Returns four numbers used by the doctor-profile "Cases" card:
 *
 *   - openCases:       count of OPEN cases led by this doctor
 *   - resolvedLast30d: count of RESOLVED cases closed in the last 30 days
 *   - repeatRatePct:   % of appointments in the last 90d that are visit #2+
 *                      within their case (1 decimal). Numerator: appointments
 *                      that have at least one earlier sibling in the same case
 *                      (ordered by date asc, createdAt asc as in the appt
 *                      detail handler — keeps repeat counting consistent).
 *                      Denominator: ALL appointments by this doctor in 90d.
 *   - avgDurationDays: average (closedAt - openedAt) in whole days for
 *                      RESOLVED cases this doctor leads.
 *
 * Tenant scope: Prisma extension auto-filters MedicalCase + Appointment by
 * clinicId. DOCTOR role must own the row (doctor.userId === ctx.userId);
 * other DOCTORs see 403.
 *
 * Implementation: 4 small queries dispatched in parallel via Promise.all —
 * single round-trip-equivalent latency.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound, forbidden } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/case-stats → id is at length-2.
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const doctorId = idFromUrl(request);

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true, userId: true },
    });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [openCases, resolvedLast30d, resolvedCases, last90dAppts] =
      await Promise.all([
        prisma.medicalCase.count({
          where: { primaryDoctorId: doctorId, status: "OPEN" },
        }),
        prisma.medicalCase.count({
          where: {
            primaryDoctorId: doctorId,
            status: "RESOLVED",
            closedAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.medicalCase.findMany({
          where: {
            primaryDoctorId: doctorId,
            status: "RESOLVED",
            closedAt: { not: null },
          },
          select: { openedAt: true, closedAt: true },
        }),
        prisma.appointment.findMany({
          where: {
            doctorId,
            date: { gte: ninetyDaysAgo },
          },
          select: {
            id: true,
            date: true,
            createdAt: true,
            medicalCaseId: true,
          },
        }),
      ]);

    // Average resolved-case duration in whole days. Skip rows where closedAt
    // is null (defensive — query already filters but TypeScript doesn't know).
    let avgDurationDays = 0;
    if (resolvedCases.length > 0) {
      let totalMs = 0;
      let n = 0;
      for (const c of resolvedCases) {
        if (!c.closedAt) continue;
        totalMs += c.closedAt.getTime() - c.openedAt.getTime();
        n += 1;
      }
      if (n > 0) {
        avgDurationDays = Math.round(totalMs / n / (24 * 60 * 60 * 1000));
      }
    }

    // Repeat rate: appointments in the last 90d for this doctor that are not
    // the first visit in their case. Group by case, sort each group, mark
    // every entry except the earliest as a "repeat".
    const totalAppts = last90dAppts.length;
    let repeats = 0;
    if (totalAppts > 0) {
      const byCase = new Map<
        string,
        Array<{ id: string; date: Date; createdAt: Date }>
      >();
      // Orphan appointments (medicalCaseId === null) are never repeats — they
      // contribute only to the denominator, which is `totalAppts`.
      for (const a of last90dAppts) {
        if (!a.medicalCaseId) continue;
        const arr = byCase.get(a.medicalCaseId) ?? [];
        arr.push({ id: a.id, date: a.date, createdAt: a.createdAt });
        byCase.set(a.medicalCaseId, arr);
      }
      // For each case, fetch all siblings (incl. those outside the 90d window)
      // so we don't accidentally count a visit as "first" just because the
      // earlier sibling fell out of the window. Cheap because we only fetch
      // ids+dates for cases this doctor actually touched in the last 90d.
      const caseIds = [...byCase.keys()];
      const allSiblings = caseIds.length
        ? await prisma.appointment.findMany({
            where: { medicalCaseId: { in: caseIds } },
            select: {
              id: true,
              medicalCaseId: true,
              date: true,
              createdAt: true,
            },
          })
        : [];
      const firstByCase = new Map<string, string>();
      const siblingsByCase = new Map<
        string,
        Array<{ id: string; date: Date; createdAt: Date }>
      >();
      for (const s of allSiblings) {
        if (!s.medicalCaseId) continue;
        const arr = siblingsByCase.get(s.medicalCaseId) ?? [];
        arr.push({ id: s.id, date: s.date, createdAt: s.createdAt });
        siblingsByCase.set(s.medicalCaseId, arr);
      }
      for (const [cid, siblings] of siblingsByCase) {
        siblings.sort((a, b) => {
          const d = a.date.getTime() - b.date.getTime();
          if (d !== 0) return d;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
        const firstId = siblings[0]?.id;
        if (firstId) firstByCase.set(cid, firstId);
      }
      for (const [cid, group] of byCase) {
        const firstId = firstByCase.get(cid);
        for (const a of group) {
          if (a.id !== firstId) repeats += 1;
        }
      }
    }
    const repeatRatePct =
      totalAppts > 0 ? Math.round((repeats / totalAppts) * 1000) / 10 : 0;

    return ok({
      doctorId,
      openCases,
      resolvedLast30d,
      repeatRatePct,
      avgDurationDays,
    });
  },
);
