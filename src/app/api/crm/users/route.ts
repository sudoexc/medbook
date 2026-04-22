/**
 * /api/crm/users — list + create clinic staff.
 *
 * See docs/TZ.md §10.Фаза 4. ADMIN only.
 *
 * Multi-tenancy: User lives in MODELS_WITHOUT_TENANT so the extension does NOT
 * auto-scope. We MUST filter by `ctx.clinicId` manually.
 */
import bcrypt from "bcryptjs";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateUserSchema,
  QueryUserSchema,
} from "@/server/schemas/user";

function redactUser<T extends { passwordHash?: string | null }>(
  u: T
): Omit<T, "passwordHash"> {
  const { passwordHash: _pw, ...rest } = u;
  void _pw;
  return rest;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryUserSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    if (ctx.kind !== "TENANT") {
      return err("Forbidden", 403);
    }

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.role) where.role = q.role;
    if (typeof q.active === "boolean") where.active = q.active;
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: "insensitive" } },
        { email: { contains: q.q, mode: "insensitive" } },
        { phone: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const take = q.limit + 1;
    const rows = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({
      rows: rows.map(redactUser),
      nextCursor,
    });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateUserSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("Forbidden", 403);
    }
    // Block creating SUPER_ADMIN from a tenant-scoped endpoint.
    if (body.role === "SUPER_ADMIN") {
      return err("Forbidden", 403, { reason: "cannot_create_super_admin" });
    }

    const existing = await prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) {
      return err("conflict", 409, { reason: "email_taken" });
    }

    const passwordHash = body.password
      ? await bcrypt.hash(body.password, 10)
      : null;

    const created = await prisma.user.create({
      data: {
        clinicId: ctx.clinicId,
        email: body.email,
        name: body.name,
        role: body.role,
        phone: body.phone ?? null,
        photoUrl: body.photoUrl ?? null,
        telegramId: body.telegramId ?? null,
        active: body.active ?? true,
        passwordHash,
      },
    });

    await audit(request, {
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      meta: { after: redactUser(created) },
    });

    return ok(redactUser(created), 201);
  }
);
