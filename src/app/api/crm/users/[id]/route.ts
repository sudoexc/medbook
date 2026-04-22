/**
 * /api/crm/users/[id] — read / update / soft-delete a clinic staff user.
 *
 * ADMIN only. Tenant-scoped manually (User is in MODELS_WITHOUT_TENANT).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateUserSchema } from "@/server/schemas/user";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function redactUser<T extends { passwordHash?: string | null }>(u: T) {
  const { passwordHash: _pw, ...rest } = u;
  void _pw;
  return rest;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const row = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!row) return notFound();
    return ok(redactUser(row));
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateUserSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const before = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!before) return notFound();

    // Block role-elevation into SUPER_ADMIN from the tenant endpoint.
    if (body.role === "SUPER_ADMIN") {
      return err("Forbidden", 403, { reason: "cannot_elevate_super_admin" });
    }
    // Block demoting the last ADMIN on a clinic.
    if (before.role === "ADMIN" && body.role && body.role !== "ADMIN") {
      const adminsLeft = await prisma.user.count({
        where: { clinicId: ctx.clinicId, role: "ADMIN", active: true, id: { not: id } },
      });
      if (adminsLeft === 0) {
        return err("conflict", 409, { reason: "last_admin" });
      }
    }

    // Password change must go through reset-password endpoint.
    const { password: _pw, ...rest } = body;
    void _pw;

    const after = await prisma.user.update({
      where: { id },
      data: {
        ...(rest.email !== undefined ? { email: rest.email } : {}),
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.role !== undefined ? { role: rest.role } : {}),
        ...(rest.phone !== undefined ? { phone: rest.phone } : {}),
        ...(rest.photoUrl !== undefined ? { photoUrl: rest.photoUrl } : {}),
        ...(rest.telegramId !== undefined ? { telegramId: rest.telegramId } : {}),
        ...(rest.active !== undefined ? { active: rest.active } : {}),
      },
    });

    const d = diff(
      redactUser(before) as unknown as Record<string, unknown>,
      redactUser(after) as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "user.update",
      entityType: "User",
      entityId: id,
      meta: d,
    });
    return ok(redactUser(after));
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const before = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!before) return notFound();

    // Block deactivating the last active admin.
    if (before.role === "ADMIN") {
      const adminsLeft = await prisma.user.count({
        where: { clinicId: ctx.clinicId, role: "ADMIN", active: true, id: { not: id } },
      });
      if (adminsLeft === 0) {
        return err("conflict", 409, { reason: "last_admin" });
      }
    }
    // Prevent self-deactivation.
    if (before.id === ctx.userId) {
      return err("conflict", 409, { reason: "cannot_deactivate_self" });
    }

    await prisma.user.update({
      where: { id },
      data: { active: false },
    });
    await audit(request, {
      action: "user.deactivate",
      entityType: "User",
      entityId: id,
      meta: { before: redactUser(before) },
    });
    return ok({ id, deactivated: true });
  }
);
