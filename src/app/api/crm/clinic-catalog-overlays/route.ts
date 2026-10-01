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

import { Prisma } from "@/generated/prisma/client";
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  OVERLAY_OVERRIDES_MAX_JSON,
  isOverridableEntityType,
  minimizeOverrides,
  sanitizeOverrides,
} from "@/server/catalog/clinic-overlay";
import { err, ok } from "@/server/http";

const ENTITY_TYPES = [
  "DRUG",
  "PROTOCOL",
  "HANDOUT",
  "LAB_TEST",
  "LAB_PANEL",
  "GUIDE",
] as const;

const PostSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityCode: z.string().trim().min(1).max(120),
  // Omitted = keep the existing flag (or `false` on create when overrides
  // are supplied, `true` on a bare hide-create — the G6 behaviour).
  hideGlobal: z.boolean().optional(),
  // Ф4 — whitelisted field patch merged over the global row at read time.
  // `null` clears a previously stored override.
  overrides: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .refine(
      (v) => v == null || JSON.stringify(v).length <= OVERLAY_OVERRIDES_MAX_JSON,
      { message: "overrides payload too large" },
    ),
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

    // Overrides only make sense for entity types with a field whitelist.
    if (
      body.overrides != null &&
      !isOverridableEntityType(body.entityType)
    ) {
      return err("OverridesNotSupported", 400, {
        reason: "entity_type_not_overridable",
      });
    }
    const existing = await prisma.clinicCatalogOverlay.findUnique({
      where: {
        clinicId_entityType_entityCode: {
          clinicId: ctx.clinicId,
          entityType: body.entityType,
          entityCode: body.entityCode,
        },
      },
    });

    let sanitized =
      body.overrides != null && isOverridableEntityType(body.entityType)
        ? sanitizeOverrides(body.entityType, body.overrides)
        : null;
    // `overrides` present in the body (even null/{}) = caller manages the
    // patch; undefined = legacy hide-only call, leave the column untouched.
    const touchOverrides = body.overrides !== undefined;
    if (touchOverrides && body.entityType === "DRUG") {
      // Store only what differs from the global drug (audit CT-10): the form
      // posts every field, and an unchanged one must keep following the
      // catalog instead of being pinned (or, for dosing, blanked).
      if (sanitized) {
        const globalDrug = await prisma.drug.findFirst({
          where: { id: body.entityCode, clinicId: null },
          select: {
            nameRu: true,
            nameUz: true,
            defaultDosing: true,
            contraindications: true,
            sideEffects: true,
            rxOnly: true,
          },
        });
        if (globalDrug) {
          sanitized = minimizeOverrides("DRUG", sanitized, globalDrug);
        }
      }
      // The clinic's packaging photo rides in the same JSON but has its own
      // upload route; editing (or resetting) the text must not drop it.
      const keptPhoto = (
        sanitizeOverrides("DRUG", existing?.overridesJson) ?? {}
      ).photoUrl;
      if (keptPhoto !== undefined && sanitized?.photoUrl === undefined) {
        sanitized = { ...(sanitized ?? {}), photoUrl: keptPhoto };
      }
    }
    const overridesData = touchOverrides
      ? {
          overridesJson: sanitized
            ? (sanitized as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        }
      : {};

    if (existing) {
      const updated = await prisma.clinicCatalogOverlay.update({
        where: { id: existing.id },
        data: {
          hideGlobal: body.hideGlobal ?? existing.hideGlobal,
          ...overridesData,
          updatedById: ctx.userId,
        },
      });
      await audit(request, {
        action: AUDIT_ACTION.CATALOG_OVERLAY_UPDATED,
        entityType: "ClinicCatalogOverlay",
        entityId: updated.id,
        meta: {
          targetEntityType: body.entityType,
          entityCode: body.entityCode,
          hideGlobal: updated.hideGlobal,
          hasOverrides: sanitized != null,
          overrideFields: sanitized ? Object.keys(sanitized) : [],
        },
      });
      return ok({ overlay: updated });
    }

    // Nothing differs from the catalog and nothing to hide: no row to store.
    if (touchOverrides && sanitized == null && body.hideGlobal === undefined) {
      return ok({ overlay: null });
    }

    const created = await prisma.clinicCatalogOverlay.create({
      data: {
        clinicId: ctx.clinicId,
        entityType: body.entityType,
        entityCode: body.entityCode,
        // A pure override-create must not hide the row it patches, even
        // when the patch turned out to equal the catalog.
        hideGlobal: body.hideGlobal ?? !touchOverrides,
        ...overridesData,
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
        hideGlobal: created.hideGlobal,
        hasOverrides: sanitized != null,
        overrideFields: sanitized ? Object.keys(sanitized) : [],
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
