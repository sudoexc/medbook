/**
 * /api/crm/clinic-catalog-overlays — per-clinic hide list (Phase G6).
 *
 * MVP scope: ADMIN can flag a curated catalog entry as hidden for their
 * clinic. Hidden entries disappear from doctor catalog drawers (the
 * read-side wires this in G8 when the dashboard lands). Doctors / nurses
 * cannot mutate the overlay — they only see the result through the
 * existing catalog routes.
 *
 * The overlay is the contract that lets future iterations layer
 * clinic-local custom dosing notes or renamed handouts on top of curated
 * content without forking the seed. The `overridesJson` column is
 * reserved for that — POST/PATCH currently only flip `hideGlobal`.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, ok } from "@/server/http";

const ENTITY_TYPES = ["DRUG", "PROTOCOL", "HANDOUT", "LAB_TEST", "LAB_PANEL"] as const;

const PostSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityCode: z.string().trim().min(1).max(120),
  hideGlobal: z.boolean().default(true),
});

const DeleteSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
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

    const rows = await prisma.clinicCatalogOverlay.findMany({
      where: {
        clinicId: ctx.clinicId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return ok({ overlays: rows });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: PostSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const existing = await prisma.clinicCatalogOverlay.findUnique({
      where: {
        clinicId_entityType_entityCode: {
          clinicId: ctx.clinicId,
          entityType: body.entityType,
          entityCode: body.entityCode,
        },
      },
    });

    if (existing) {
      const updated = await prisma.clinicCatalogOverlay.update({
        where: { id: existing.id },
        data: { hideGlobal: body.hideGlobal, updatedById: ctx.userId },
      });
      await audit(request, {
        action: AUDIT_ACTION.CATALOG_OVERLAY_UPDATED,
        entityType: "ClinicCatalogOverlay",
        entityId: updated.id,
        meta: {
          targetEntityType: body.entityType,
          entityCode: body.entityCode,
          hideGlobal: body.hideGlobal,
        },
      });
      return ok({ overlay: updated });
    }

    const created = await prisma.clinicCatalogOverlay.create({
      data: {
        clinicId: ctx.clinicId,
        entityType: body.entityType,
        entityCode: body.entityCode,
        hideGlobal: body.hideGlobal,
        createdById: ctx.userId,
      },
    });
    await audit(request, {
      action: AUDIT_ACTION.CATALOG_OVERLAY_CREATED,
      entityType: "ClinicCatalogOverlay",
      entityId: created.id,
      meta: {
        targetEntityType: body.entityType,
        entityCode: body.entityCode,
        hideGlobal: body.hideGlobal,
      },
    });
    return ok({ overlay: created });
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"], bodySchema: DeleteSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const existing = await prisma.clinicCatalogOverlay.findUnique({
      where: {
        clinicId_entityType_entityCode: {
          clinicId: ctx.clinicId,
          entityType: body.entityType,
          entityCode: body.entityCode,
        },
      },
    });
    if (!existing) return ok({ removed: false });

    await prisma.clinicCatalogOverlay.delete({ where: { id: existing.id } });
    await audit(request, {
      action: AUDIT_ACTION.CATALOG_OVERLAY_DELETED,
      entityType: "ClinicCatalogOverlay",
      entityId: existing.id,
      meta: {
        targetEntityType: body.entityType,
        entityCode: body.entityCode,
        hideGlobal: existing.hideGlobal,
      },
    });
    return ok({ removed: true });
  },
);
