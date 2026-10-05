/**
 * /api/crm/doctor-favorites — per-user catalog pins (Phase G6).
 *
 * Tiny CRUD: GET lists the current doctor's pinned entries (optionally
 * filtered to a single entityType — handy when a catalog drawer asks
 * "give me my drug favourites only"). POST adds a pin, DELETE removes it.
 * The drawer treats these as a presentation layer (float to top + ★ badge),
 * so the API is intentionally minimal — no batch, no reorder yet.
 *
 * Auth: any clinical role (ADMIN/DOCTOR/NURSE/RECEPTIONIST) can manage
 * their own favourites. Favourites are private to the user — there is no
 * "see my colleague's pins" surface.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { ARSENAL_MAX } from "@/lib/arsenal";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, ok } from "@/server/http";
import { isPinnableDiagnosisCode } from "@/server/icd10/clinic-catalog";

const ENTITY_TYPES = ["DRUG", "PROTOCOL", "HANDOUT", "LAB_TEST", "LAB_PANEL", "ICD10"] as const;

const BodySchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  // Code is the stable catalog slug — Drug.id ("paracetamol"), HandoutTemplate.code
  // ("HTN_LIFESTYLE"), LabTest.code, LabPanel.code, ClinicalProtocol.code.
  entityCode: z.string().trim().min(1).max(120),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const url = new URL(request.url);
    const entityTypeParam = url.searchParams.get("entityType");
    const entityType =
      entityTypeParam && (ENTITY_TYPES as readonly string[]).includes(entityTypeParam)
        ? (entityTypeParam as (typeof ENTITY_TYPES)[number])
        : null;

    const rows = await prisma.doctorFavorite.findMany({
      where: {
        userId: ctx.userId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok({ favorites: rows });
  },
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"],
    bodySchema: BodySchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // Idempotent: upsert by the (userId, entityType, entityCode) unique key.
    // If the favourite already exists we return the existing row without
    // bumping sortOrder so the drawer doesn't accidentally re-sort.
    const existing = await prisma.doctorFavorite.findUnique({
      where: {
        userId_entityType_entityCode: {
          userId: ctx.userId,
          entityType: body.entityType,
          entityCode: body.entityCode,
        },
      },
    });
    if (existing) return ok({ favorite: existing, created: false });

    // «Мой арсенал» (03.10.2026): drug and diagnosis stars ARE the arsenal,
    // which holds 30 per kind. A star past that is refused with a reason the
    // visit screen names, instead of growing a list he can no longer scan.
    if (body.entityType === "DRUG" || body.entityType === "ICD10") {
      const pinned = await prisma.doctorFavorite.count({
        where: { userId: ctx.userId, entityType: body.entityType },
      });
      if (pinned >= ARSENAL_MAX) {
        return err("ArsenalFull", 409, { reason: "arsenal_full", max: ARSENAL_MAX });
      }
    }

    // A diagnosis star is an arsenal pin, and a pin is only a code: one of
    // the classifier or of the clinic's own catalog, as «Мой арсенал»
    // checks it. A code from nowhere would be a nameless slot in his 30.
    if (body.entityType === "ICD10" && !(await isPinnableDiagnosisCode(body.entityCode))) {
      return err("NotFound", 404, { reason: "diagnosis_unknown" });
    }

    const created = await prisma.doctorFavorite.create({
      data: {
        userId: ctx.userId,
        entityType: body.entityType,
        entityCode: body.entityCode,
        // Insertion order sortOrder — epoch millis fits comfortably in Int32
        // until 2038, and gives us a stable order without a follow-up query.
        sortOrder: Math.floor(Date.now() / 1000),
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_FAVORITE_ADDED,
      entityType: "DoctorFavorite",
      entityId: created.id,
      meta: {
        userId: ctx.userId,
        targetEntityType: body.entityType,
        entityCode: body.entityCode,
      },
    });

    return ok({ favorite: created, created: true });
  },
);

export const DELETE = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"],
    bodySchema: BodySchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const existing = await prisma.doctorFavorite.findUnique({
      where: {
        userId_entityType_entityCode: {
          userId: ctx.userId,
          entityType: body.entityType,
          entityCode: body.entityCode,
        },
      },
    });
    if (!existing) return ok({ removed: false });

    await prisma.doctorFavorite.delete({ where: { id: existing.id } });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_FAVORITE_REMOVED,
      entityType: "DoctorFavorite",
      entityId: existing.id,
      meta: {
        userId: ctx.userId,
        targetEntityType: body.entityType,
        entityCode: body.entityCode,
      },
    });

    return ok({ removed: true });
  },
);
