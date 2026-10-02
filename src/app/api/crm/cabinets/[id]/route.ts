/**
 * /api/crm/cabinets/[id] — get/patch/delete.
 *
 * Cabinet binding (Phase 11):
 *   A cabinet is bound 1:1 to a doctor (Doctor.cabinetId NOT NULL UNIQUE).
 *   DELETE refuses (409) when the cabinet is currently occupied — the admin
 *   must move the doctor to a different cabinet first, or deactivate the
 *   doctor (which itself fans out to a service-orphan check).
 *
 * The occupant is looked up clinic-wide (audit ST-13): with a branch
 * selected, the Prisma extension filtered the doctor lookup by that branch,
 * so a doctor of another branch (or of none) did not count and his cabinet
 * could be switched off under him.
 */
import type { TenantContext } from "@/lib/tenant-context";
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateCabinetSchema } from "@/server/schemas/cabinet";
import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";
import { runClinicWide } from "@/server/branches/branch-rules";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function findOccupant(ctx: TenantContext, cabinetId: string) {
  return runClinicWide(ctx, () =>
    prisma.doctor.findUnique({
      where: { cabinetId },
      select: { id: true, nameRu: true },
    }),
  );
}

function occupiedResponse(occupant: { id: string; nameRu: string }) {
  return err("CabinetOccupied", 409, {
    reason: "cabinet_occupied",
    doctorId: occupant.id,
    doctorName: occupant.nameRu,
  });
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.cabinet.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateCabinetSchema },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    const { branchId: requestedBranchId, ...data } = body;
    const update: Record<string, unknown> = data;

    // A move to another branch is checked like a create (audit ST-13): the
    // body used to be written as is, so any id (another clinic's, a switched
    // off branch's) landed in the column. A cabinet with a doctor in it does
    // not move: the doctor's own branch would stay behind, and the screens
    // of both branches would disagree about the room.
    const moving =
      requestedBranchId !== undefined && requestedBranchId !== before.branchId;
    if (moving) {
      if (!requestedBranchId) {
        // Without a branch the cabinet drops out of every branch's screens.
        return err("BranchInvalid", 422, { reason: "branch_required" });
      }
      try {
        update.branchId = await resolveEffectiveBranchId(ctx, requestedBranchId);
      } catch (e) {
        const reason = (e as { reason?: string }).reason ?? "branch_invalid";
        return err("BranchInvalid", 422, { reason });
      }
    }

    // Same invariant as DELETE: a cabinet that still has a doctor bound to it
    // cannot be deactivated, since Doctor.cabinetId is NOT NULL and would
    // leave the doctor pointing at a disabled room.
    const deactivating = body.isActive === false && before.isActive;
    if (deactivating || moving) {
      const occupant = await findOccupant(ctx, id);
      if (occupant) return occupiedResponse(occupant);
    }
    const after = await prisma.cabinet.update({ where: { id }, data: update as never });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "cabinet.update",
      entityType: "Cabinet",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    const occupant = await findOccupant(ctx, id);
    if (occupant) return occupiedResponse(occupant);
    await prisma.cabinet.update({ where: { id }, data: { isActive: false } });
    await audit(request, {
      action: "cabinet.deactivate",
      entityType: "Cabinet",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
