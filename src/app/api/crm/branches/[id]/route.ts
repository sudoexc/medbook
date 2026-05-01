/**
 * /api/crm/branches/[id] — get / patch / soft-delete a branch.
 *
 * Phase 9c. ADMIN-only for mutating endpoints. Soft-delete via
 * `isActive=false`; hard delete is rejected. The "at least one active branch
 * per clinic" invariant is enforced here and on PATCH (cannot disable the
 * last active branch). When `isDefault=true` is set on a branch, the route
 * clears `isDefault` on every other branch within the same clinic in a
 * single transaction so the singleton property holds.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err, diff } from "@/server/http";
import { UpdateBranchSchema } from "@/server/schemas/branch";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.branch.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  },
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateBranchSchema },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.branch.findUnique({ where: { id } });
    if (!before) return notFound();

    // Disabling a branch (isActive=false) — refuse if it would leave the
    // clinic with zero active branches.
    if (body.isActive === false && before.isActive) {
      const remaining = await prisma.branch.count({
        where: { isActive: true, NOT: { id } },
      });
      if (remaining === 0) {
        return err("LastActiveBranch", 422, {
          reason: "last_active_branch",
        });
      }
    }

    const after = await prisma.$transaction(async (tx) => {
      const clinicId =
        ctx.kind === "TENANT" ? ctx.clinicId : (before as { clinicId: string }).clinicId;

      // Singleton invariant: setting isDefault=true clears the flag on
      // every sibling. Setting it to false is allowed (caller may want to
      // pick a different default in the same request via a follow-up call).
      if (body.isDefault === true) {
        await tx.branch.updateMany({
          where: { clinicId, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.branch.update({
        where: { id },
        data: body as never,
      });
    });

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await audit(request, {
      action: "branch.update",
      entityType: "Branch",
      entityId: id,
      meta: d,
    });
    return ok(after);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.branch.findUnique({ where: { id } });
    if (!before) return notFound();

    if (before.isActive) {
      const remaining = await prisma.branch.count({
        where: { isActive: true, NOT: { id } },
      });
      if (remaining === 0) {
        return err("LastActiveBranch", 422, {
          reason: "last_active_branch",
        });
      }
    }

    await prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
    await audit(request, {
      action: "branch.deactivate",
      entityType: "Branch",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  },
);
