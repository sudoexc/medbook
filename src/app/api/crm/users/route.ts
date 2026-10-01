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
import { redactStaffUser } from "@/server/users/staff-user";
import { runClinicWide } from "@/server/branches/branch-rules";

// Secrets (password hash, TOTP material) never leave the server.
const redactUser = redactStaffUser;

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
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      }),
      prisma.user.count({ where }),
    ]);
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    // The schedule card each doctor login holds, so the edit dialog can show
    // it and ask for one when it is missing (audit ST-04).
    // Clinic-wide: a selected branch must not hide a doctor's card.
    const cards =
      rows.length > 0
        ? await runClinicWide(ctx, () =>
            prisma.doctor.findMany({
              where: { userId: { in: rows.map((r) => r.id) } },
              select: { id: true, userId: true, nameRu: true },
            }),
          )
        : [];
    const cardByUser = new Map(cards.map((c) => [c.userId, c]));
    return ok({
      rows: rows.map((r) => {
        const card = cardByUser.get(r.id);
        return {
          ...redactUser(r),
          doctorCard: card ? { id: card.id, nameRu: card.nameRu } : null,
        };
      }),
      nextCursor,
      total,
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
      // Email is unique across the installation, so a deactivated colleague
      // keeps it. Say so: the way back is to switch that account on again
      // (audit ST-04), not a second login.
      const inactiveHere =
        existing.clinicId === ctx.clinicId && !existing.active;
      return err("conflict", 409, {
        reason: inactiveHere ? "email_taken_inactive" : "email_taken",
      });
    }

    if (body.role === "DOCTOR") {
      const doctor = await prisma.doctor.findUnique({
        where: { id: body.doctorId! },
      });
      if (!doctor) {
        return err("conflict", 422, { reason: "doctor_not_found" });
      }
      if (doctor.userId) {
        return err("conflict", 409, { reason: "doctor_taken" });
      }
    }

    const passwordHash = body.password
      ? await bcrypt.hash(body.password, 10)
      : null;

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
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
            mustChangePassword: Boolean(passwordHash),
            invitedById: ctx.userId,
          },
        });
        if (body.role === "DOCTOR" && body.doctorId) {
          await tx.doctor.update({
            where: { id: body.doctorId },
            data: { userId: user.id },
          });
        }
        return user;
      });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") && msg.includes("userId")) {
        return err("conflict", 409, { reason: "doctor_taken" });
      }
      throw e;
    }

    await audit(request, {
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      meta: { after: redactUser(created) },
    });

    return ok(redactUser(created), 201);
  }
);
