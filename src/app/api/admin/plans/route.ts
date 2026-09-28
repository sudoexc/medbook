/**
 * GET /api/admin/plans — list active Plan rows for the SUPER_ADMIN billing UI.
 *
 * Read-only and unfiltered: returns every `isActive=true` plan ordered by
 * `sortOrder` then name. Used by the plan-select dropdown on the
 * `/admin/clinics/[id]/billing` page.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/platform/handler";

export async function GET(): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
    });
    return ok({ plans });
  });
}
