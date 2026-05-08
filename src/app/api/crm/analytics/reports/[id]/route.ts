/**
 * /api/crm/analytics/reports/[id] — get / update / delete one saved report.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import {
  ReportConfigSchema,
  parseReportConfig,
  type ReportConfig,
} from "@/server/analytics/report-config";
import { conflict, err, notFound, ok } from "@/server/http";
import { z } from "zod";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const UpdateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: z.unknown().optional(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    const row = await prisma.savedReport.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        lastRunAt: true,
        createdByUserId: true,
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!row) return notFound();
    let config: ReportConfig | null = null;
    try {
      config = parseReportConfig(row.config);
    } catch {
      // Persisted shape is invalid — surface to the UI instead of crashing
      // by returning a typed error. The list page can still show the row.
      return err("StoredReportInvalid", 422, { id: row.id });
    }
    return ok({
      id: row.id,
      name: row.name,
      description: row.description,
      config,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastRunAt: row.lastRunAt,
      createdByUserId: row.createdByUserId,
      createdByLabel: row.createdBy?.name ?? row.createdBy?.email ?? null,
    });
  },
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateBodySchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    const existing = await prisma.savedReport.findFirst({
      where: { id },
      select: { id: true, name: true, config: true, description: true },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};

    if (body.name !== undefined && body.name !== existing.name) {
      const collision = await prisma.savedReport.findFirst({
        where: { name: body.name, NOT: { id } },
        select: { id: true },
      });
      if (collision) return conflict("name_taken");
      data.name = body.name;
    }
    if (body.description !== undefined) {
      data.description = body.description;
    }
    let nextConfig: ReportConfig | null = null;
    if (body.config !== undefined) {
      try {
        nextConfig = parseReportConfig(body.config);
      } catch (e) {
        const issues = (e as { issues?: unknown }).issues;
        return err("InvalidReportConfig", 422, { issues });
      }
      data.config = nextConfig as unknown as object;
    }

    if (Object.keys(data).length === 0) {
      return ok({ id, unchanged: true });
    }

    const updated = await prisma.savedReport.update({
      where: { id },
      data: data as never,
    });

    await audit(request, {
      action: AUDIT_ACTION.SAVED_REPORT_UPDATED,
      entityType: "SavedReport",
      entityId: id,
      meta: {
        nameAfter: updated.name,
        nameChanged: body.name !== undefined && body.name !== existing.name,
        configChanged: body.config !== undefined,
      },
    });
    return ok({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      config: nextConfig ?? (existing.config as unknown as ReportConfig),
      updatedAt: updated.updatedAt,
    });
  },
);

export const DELETE = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    const existing = await prisma.savedReport.findFirst({
      where: { id },
      select: { id: true, name: true, config: true },
    });
    if (!existing) return notFound();
    await prisma.savedReport.delete({ where: { id } });
    await audit(request, {
      action: AUDIT_ACTION.SAVED_REPORT_DELETED,
      entityType: "SavedReport",
      entityId: id,
      meta: {
        name: existing.name,
        config: existing.config,
      },
    });
    return ok({ id, deleted: true });
  },
);

export const __schema = ReportConfigSchema;
