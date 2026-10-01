/**
 * /api/crm/branches/[id] — get / patch / soft-delete a branch.
 *
 * Phase 9c. ADMIN-only for mutating endpoints. Soft-delete via
 * `isActive=false`; hard delete is rejected. The "at least one active branch
 * per clinic" invariant is enforced here and on PATCH (cannot disable the
 * last active branch). When `isDefault=true` is set on a branch, the route
 * clears `isDefault` on every other branch within the same clinic in a
 * single transaction so the singleton property holds.
 *
 * Audit ST-06: the default branch cannot be switched off or lose its flag
 * without another default (`branchChangeRefusal`), and switching off a
 * branch that still has active doctors, cabinets or upcoming visits answers
 * 409 `branch_in_use` with the counts until the admin confirms
 * (`confirmInUse: true` on PATCH, `?confirm=1` on DELETE). Every change
 * forgets the cached "is this cookie branch live" answers.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err, diff } from "@/server/http";
import { UpdateBranchSchema } from "@/server/schemas/branch";
import { forgetLiveBranch } from "@/server/branches/active-branch-guard";
import {
  branchChangeRefusal,
  branchInUse,
  loadBranchUsage,
} from "@/server/branches/branch-rules";

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

    const { confirmInUse, ...data } = body;
    const deactivating = data.isActive === false && before.isActive;
    const refusal = branchChangeRefusal({
      before,
      patch: data,
      otherActiveCount: deactivating
        ? await prisma.branch.count({ where: { isActive: true, NOT: { id } } })
        : 1,
    });
    if (refusal) {
      return err(
        refusal === "last_active_branch" ? "LastActiveBranch" : "BranchRule",
        422,
        { reason: refusal },
      );
    }
    if (deactivating && confirmInUse !== true) {
      const usage = await loadBranchUsage(ctx, id);
      if (branchInUse(usage)) {
        return err("conflict", 409, { reason: "branch_in_use", usage });
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
        data: data as never,
      });
    });
    forgetLiveBranch(id);

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
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.branch.findUnique({ where: { id } });
    if (!before) return notFound();

    if (before.isActive) {
      const refusal = branchChangeRefusal({
        before,
        patch: { isActive: false },
        otherActiveCount: await prisma.branch.count({
          where: { isActive: true, NOT: { id } },
        }),
      });
      if (refusal) {
        return err(
          refusal === "last_active_branch" ? "LastActiveBranch" : "BranchRule",
          422,
          { reason: refusal },
        );
      }
      const confirmed = new URL(request.url).searchParams.get("confirm") === "1";
      if (!confirmed) {
        const usage = await loadBranchUsage(ctx, id);
        if (branchInUse(usage)) {
          return err("conflict", 409, { reason: "branch_in_use", usage });
        }
      }
    }

    await prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
    forgetLiveBranch(id);
    await audit(request, {
      action: "branch.deactivate",
      entityType: "Branch",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  },
);
