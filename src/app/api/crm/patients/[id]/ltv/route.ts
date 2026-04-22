/**
 * /api/crm/patients/[id]/ltv — recompute LTV on demand. See docs/TZ.md §5.4.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/server/http";
import { recalcLtv } from "@/server/services/ltv";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/ltv
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) return notFound();
    const ltv = await recalcLtv(id);
    const avgCheck = patient.visitsCount > 0 ? Math.round(ltv / patient.visitsCount) : 0;
    return ok({ patientId: id, ltv, visitsCount: patient.visitsCount, avgCheck });
  }
);
