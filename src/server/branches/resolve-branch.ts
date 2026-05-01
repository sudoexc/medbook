/**
 * Phase 9c — Resolve the effective branchId for create operations.
 *
 * Branch-scoped models (Doctor, Cabinet, Appointment, …) carry a NULLABLE
 * `branchId` after migration `20260501084339_add_branches`. The Prisma
 * extension auto-fills `branchId` on writes when the active TenantContext
 * has one (set via the active-branch cookie). For routes that want to
 * accept an explicit override from the request body — and to fall back
 * gracefully to the clinic's default branch when neither override nor
 * cookie is present — call this helper before passing data to Prisma.
 *
 * Resolution order:
 *   1. `bodyOverride` (when provided) — must belong to the active clinic.
 *   2. `ctx.branchId` (cookie) — already validated when the cookie was set.
 *   3. The clinic's `isDefault=true` branch — there's always one (seed +
 *      backfill enforce this).
 *   4. `null` — the branch column stays nullable, so writes still succeed.
 */
import { prisma } from "@/lib/prisma";
import type { TenantContext } from "@/lib/tenant-context";

export async function resolveEffectiveBranchId(
  ctx: TenantContext,
  bodyOverride?: string | null,
): Promise<string | null> {
  if (ctx.kind !== "TENANT") return null;

  if (bodyOverride) {
    // The Prisma extension will reject reads from another clinic — a
    // cross-clinic id surfaces as `null` here.
    const found = await prisma.branch.findUnique({
      where: { id: bodyOverride },
      select: { id: true, isActive: true },
    });
    if (!found) {
      throw Object.assign(new Error("BranchNotFound"), {
        status: 422,
        reason: "branch_not_found",
      });
    }
    if (!found.isActive) {
      throw Object.assign(new Error("BranchInactive"), {
        status: 422,
        reason: "branch_inactive",
      });
    }
    return found.id;
  }

  if (ctx.branchId) return ctx.branchId;

  const def = await prisma.branch.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  });
  return def?.id ?? null;
}
