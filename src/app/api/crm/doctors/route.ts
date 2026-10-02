/**
 * /api/crm/doctors — list + create. See docs/TZ.md §6.6.
 *
 * Cabinet binding (Phase 11):
 *   Every doctor must occupy a cabinet (Doctor.cabinetId is NOT NULL UNIQUE).
 *   POST validates that the requested cabinet exists in the current clinic
 *   AND is not already occupied. The route uses a single transaction so the
 *   doctor row + ServiceOnDoctor links land atomically.
 */
import { randomBytes } from "node:crypto";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { CreateDoctorSchema, QueryDoctorSchema } from "@/server/schemas/doctor";
import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";
import { doctorAudience, doctorSelectFor } from "@/server/doctors/doctor-view";
import { findForeignServiceIds } from "@/server/doctors/service-links";
import {
  isTicketPrefixConflict,
  nextFreeTicketPrefix,
} from "@/server/doctors/ticket-prefix";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryDoctorSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (typeof q.isActive === "boolean") where.isActive = q.isActive;
    // Each filter is its own OR group joined by AND (audit DR-21): merged
    // into one OR, «Иванов» within «Невролог» returned every neurologist
    // plus every Иванов.
    const and: Record<string, unknown>[] = [];
    if (q.specialization) {
      and.push({
        OR: [
          { specializationRu: { contains: q.specialization, mode: "insensitive" } },
          { specializationUz: { contains: q.specialization, mode: "insensitive" } },
        ],
      });
    }
    if (q.q) {
      and.push({
        OR: [
          { nameRu: { contains: q.q, mode: "insensitive" } },
          { nameUz: { contains: q.q, mode: "insensitive" } },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    // Salary percent, login id and TV token are for the admin only (DR-09).
    const select = doctorSelectFor(doctorAudience(ctx));
    const rows = await prisma.doctor.findMany({
      where,
      ...(select ? { select } : { include: { cabinet: true } }),
      orderBy: { nameRu: "asc" },
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateDoctorSchema },
  async ({ request, body, ctx }) => {
    try {
      let branchId: string | null = null;
      try {
        branchId = await resolveEffectiveBranchId(ctx, body.branchId);
      } catch (e) {
        const reason = (e as { reason?: string }).reason ?? "branch_invalid";
        return err("BranchInvalid", 422, { reason });
      }

      // The Prisma extension scopes findUnique by clinicId for tenants, so
      // a cabinet from another clinic returns null even for a SUPER_ADMIN
      // impersonator. Same goes for the occupancy check below.
      const cabinet = await prisma.cabinet.findUnique({
        where: { id: body.cabinetId },
      });
      if (!cabinet || !cabinet.isActive) {
        return err("CabinetInvalid", 422, { reason: "cabinet_not_found" });
      }
      const occupant = await prisma.doctor.findUnique({
        where: { cabinetId: body.cabinetId },
      });
      if (occupant) {
        return err("CabinetTaken", 409, {
          reason: "cabinet_taken",
          doctorId: occupant.id,
        });
      }

      // Only this clinic's services may be linked (audit DR-12).
      const foreignServiceIds = await findForeignServiceIds(
        (body.services ?? []).map((s) => s.serviceId),
        ctx.kind === "TENANT" ? ctx.clinicId : null,
      );
      if (foreignServiceIds.length > 0) {
        return err("ServiceInvalid", 422, {
          reason: "service_not_found",
          serviceIds: foreignServiceIds,
        });
      }

      const created = await prisma.$transaction(async (tx) => {
        // Ticket letter (audit Q-12): the admin's pick, else the clinic's
        // next free one, so a new doctor never shares tickets with another.
        const ticketPrefix =
          body.ticketPrefix ??
          (ctx.kind === "TENANT"
            ? await nextFreeTicketPrefix(tx, ctx.clinicId)
            : null);
        const doctor = await tx.doctor.create({
          data: {
            slug: body.slug,
            nameRu: body.nameRu,
            nameUz: body.nameUz,
            specializationRu: body.specializationRu,
            specializationUz: body.specializationUz,
            // No `userId` here (audit DR-13): the login is linked from
            // /api/crm/users, which checks the user's clinic and role.
            photoUrl: body.photoUrl ?? null,
            bioRu: body.bioRu ?? null,
            bioUz: body.bioUz ?? null,
            color: body.color ?? "#3DD5C0",
            pricePerVisit: body.pricePerVisit ?? null,
            salaryPercent: body.salaryPercent ?? 40,
            isActive: body.isActive ?? true,
            branchId,
            cabinetId: body.cabinetId,
            // Personal waiting-room TV link (`/tv/d/<token>`) — minted here so
            // the copy button works the moment the doctor is created.
            tvToken: randomBytes(18).toString("base64url"),
            ticketPrefix,
          } as never,
        });
        if (body.services && body.services.length > 0) {
          await tx.serviceOnDoctor.createMany({
            data: body.services.map((s) => ({
              doctorId: doctor.id,
              serviceId: s.serviceId,
              priceOverride: s.priceOverride ?? null,
              durationMinOverride: s.durationMinOverride ?? null,
            })),
          });
        }
        return doctor;
      });

      await audit(request, {
        action: "doctor.create",
        entityType: "Doctor",
        entityId: created.id,
        meta: { after: created },
      });
      return ok(created, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") && msg.includes("cabinetId")) {
        // Race: another concurrent POST claimed the cabinet between our
        // pre-check and create. Surface the same 409 as the pre-check.
        return err("CabinetTaken", 409, { reason: "cabinet_taken" });
      }
      if (isTicketPrefixConflict(e)) {
        return err("conflict", 409, { reason: "ticket_prefix_taken" });
      }
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "slug_taken" });
      }
      throw e;
    }
  }
);
