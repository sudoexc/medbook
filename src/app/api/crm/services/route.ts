/**
 * /api/crm/services — list + create. See docs/TZ.md §6.*.settings.
 *
 * Service-doctor invariant (Phase 11):
 *   Every service MUST be performed by at least one doctor — there are no
 *   nurse-only or self-serve services in this product. POST therefore
 *   requires a non-empty doctorIds array, validates each id resolves to an
 *   existing (clinic-scoped) doctor, and creates the Service + one
 *   ServiceOnDoctor row per doctor in a single transaction.
 *
 *   Per-doctor price/duration overrides are NOT set here — they default to
 *   null so the link falls back to Service.priceBase / Service.durationMin.
 *   Admins can edit overrides afterwards from the doctor's own page.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { CreateServiceSchema, QueryServiceSchema } from "@/server/schemas/service";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryServiceSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (typeof q.isActive === "boolean") where.isActive = q.isActive;
    if (q.category) where.category = q.category;
    if (q.q) {
      where.OR = [
        { code: { contains: q.q, mode: "insensitive" } },
        { nameRu: { contains: q.q, mode: "insensitive" } },
        { nameUz: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.service.findMany({
      where,
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
  { roles: ["ADMIN"], bodySchema: CreateServiceSchema },
  async ({ request, body }) => {
    // The Prisma extension scopes findMany by clinicId for tenant contexts,
    // so a doctor id from another clinic simply doesn't appear and gets
    // caught by the count mismatch below.
    const ids = Array.from(new Set(body.doctorIds));
    const doctors = await prisma.doctor.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    if (doctors.length !== ids.length) {
      const found = new Set(doctors.map((d) => d.id));
      return err("DoctorInvalid", 422, {
        reason: "doctor_not_found",
        missingDoctorIds: ids.filter((id) => !found.has(id)),
      });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const svc = await tx.service.create({
          data: {
            code: body.code,
            nameRu: body.nameRu,
            nameUz: body.nameUz,
            category: body.category ?? null,
            durationMin: body.durationMin,
            priceBase: body.priceBase,
            isActive: body.isActive ?? true,
          } as never,
        });
        await tx.serviceOnDoctor.createMany({
          data: ids.map((doctorId) => ({
            doctorId,
            serviceId: svc.id,
            priceOverride: null,
            durationMinOverride: null,
          })),
        });
        return svc;
      });
      await audit(request, {
        action: "service.create",
        entityType: "Service",
        entityId: created.id,
        meta: { after: created, doctorIds: ids },
      });
      return ok(created, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "code_taken" });
      }
      throw e;
    }
  }
);
