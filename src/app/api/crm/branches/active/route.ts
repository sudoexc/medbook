/**
 * POST /api/crm/branches/active — set / clear the active-branch cookie.
 *
 * Phase 9c. Body: `{ branchId: string | null }`. When non-null, the server
 * verifies that the branch belongs to the caller's own clinic before
 * setting the cookie; this prevents cross-clinic switching even though the
 * cookie itself is unsigned (a forged value would still be rejected on the
 * next API call because clinicId is the source of truth).
 *
 * The cookie is HttpOnly + SameSite=Lax with a 30-day Max-Age. Clearing
 * it (`branchId === null`) returns the tenant to clinic-wide queries.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, notFound } from "@/server/http";
import { SetActiveBranchSchema } from "@/server/schemas/branch";
import { buildActiveBranchSetCookie } from "@/server/platform/branch-cookie";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"],
    bodySchema: SetActiveBranchSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("Forbidden", 403);
    }

    if (body.branchId) {
      // The Prisma extension auto-injects clinicId on `findUnique({ id })`
      // when the model has a clinicId column — so a cross-clinic id will
      // come back as `null` rather than leak data.
      const found = await prisma.branch.findUnique({
        where: { id: body.branchId },
        select: { id: true, isActive: true },
      });
      if (!found) return notFound();
      if (!found.isActive) {
        return err("BranchInactive", 422, { reason: "branch_inactive" });
      }
    }

    await audit(request, {
      action: body.branchId ? "branch.activate" : "branch.clear",
      entityType: "Branch",
      entityId: body.branchId ?? null,
      meta: { branchId: body.branchId },
    });

    const headers = new Headers();
    headers.append(
      "set-cookie",
      buildActiveBranchSetCookie(body.branchId),
    );
    return Response.json(
      { ok: true, branchId: body.branchId },
      { status: 200, headers },
    );
  },
);
