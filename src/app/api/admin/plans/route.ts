/**
 * GET /api/admin/plans — list active Plan rows for the SUPER_ADMIN billing UI.
 *
 * Read-only and unfiltered: returns every `isActive=true` plan ordered by
 * `sortOrder` then name. Used by the plan-select dropdown on the
 * `/admin/clinics/[id]/billing` page.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

export async function GET(): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
    });
    return ok({ plans });
  });
}
