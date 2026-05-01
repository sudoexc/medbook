/**
 * /api/crm/branches — list + create.
 *
 * Phase 9c. Listing is open to any logged-in tenant role (so the
 * BranchSwitcher can populate its dropdown for everyone). Creation is
 * ADMIN-only. The Branch model is NOT in `MODELS_BRANCH_SCOPED`, so the
 * Prisma extension only injects `clinicId` — Branch lookups are always
 * clinic-wide regardless of the active branch cookie.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateBranchSchema,
  QueryBranchSchema,
} from "@/server/schemas/branch";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryBranchSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (typeof q.isActive === "boolean") where.isActive = q.isActive;

    const rows = await prisma.branch.findMany({
      where,
      // Default branch first, then alphabetically by RU name for predictable
      // dropdown ordering. Clients rely on the first row being the default.
      orderBy: [{ isDefault: "desc" }, { nameRu: "asc" }],
      take: q.limit,
    });
    return ok({ rows });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateBranchSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("Forbidden", 403);
    }

    // Resolve a default timezone: clinic.timezone wins when caller leaves
    // the field blank. We need a clinic-wide read of Clinic, which is in
    // MODELS_WITHOUT_TENANT — the extension passes through.
    const timezone =
      body.timezone ??
      (
        await prisma.clinic.findUnique({
          where: { id: ctx.clinicId },
          select: { timezone: true },
        })
      )?.timezone ??
      null;

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Singleton invariant: if the new branch is marked default, clear
        // the flag on every other branch in the same clinic first.
        if (body.isDefault === true) {
          await tx.branch.updateMany({
            where: { clinicId: ctx.clinicId },
            data: { isDefault: false },
          });
        }
        return tx.branch.create({
          data: {
            slug: body.slug,
            nameRu: body.nameRu,
            nameUz: body.nameUz,
            address: body.address ?? null,
            phone: body.phone ?? null,
            timezone,
            isDefault: body.isDefault ?? false,
            isActive: body.isActive ?? true,
          } as never,
        });
      });

      await audit(request, {
        action: "branch.create",
        entityType: "Branch",
        entityId: created.id,
        meta: { after: created },
      });
      return ok(created, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") || msg.includes("unique")) {
        return err("conflict", 409, { reason: "slug_taken" });
      }
      throw e;
    }
  },
);
