/**
 * /api/crm/analytics/reports — Phase 18 Wave 3 saved reports CRUD (list + create).
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
import {
  paginate,
  SAVED_REPORT_PAGE_SIZE,
  type SavedReportListResponse,
} from "@/server/analytics/saved-reports";
import { conflict, err, ok } from "@/server/http";
import { z } from "zod";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const CreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  // Validated separately by `parseReportConfig` so we can return the
  // detailed issue list as 422 rather than a generic 400.
  config: z.unknown(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const url = new URL(request.url);
    const parsed = ListQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    const total = await prisma.savedReport.count({});
    const page = paginate({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize ?? SAVED_REPORT_PAGE_SIZE,
      total,
    });
    const rows = await prisma.savedReport.findMany({
      orderBy: [{ lastRunAt: "desc" }, { createdAt: "desc" }],
      take: page.pageSize,
      skip: page.offset,
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        lastRunAt: true,
        createdByUserId: true,
        config: true,
        createdBy: { select: { name: true, email: true } },
      },
    });
    const out: SavedReportListResponse = {
      rows: rows.map((r) => {
        const cfg = (r.config ?? {}) as Partial<ReportConfig>;
        return {
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          createdByUserId: r.createdByUserId,
          createdByLabel: r.createdBy?.name ?? r.createdBy?.email ?? null,
          createdAt: r.createdAt,
          lastRunAt: r.lastRunAt,
          dimensionsCount: Array.isArray(cfg.dimensions) ? cfg.dimensions.length : 0,
          measuresCount: Array.isArray(cfg.measures) ? cfg.measures.length : 0,
        };
      }),
      pagination: page,
    };
    return ok(out);
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateBodySchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);

    let config: ReportConfig;
    try {
      config = parseReportConfig(body.config);
    } catch (e) {
      const issues = (e as { issues?: unknown }).issues;
      return err("InvalidReportConfig", 422, { issues });
    }

    const existing = await prisma.savedReport.findFirst({
      where: { name: body.name },
      select: { id: true },
    });
    if (existing) return conflict("name_taken");

    const created = await prisma.savedReport.create({
      data: {
        clinicId: ctx.clinicId,
        createdByUserId: ctx.userId,
        name: body.name,
        description: body.description ?? null,
        config: config as unknown as object,
      } as never,
    });

    await audit(request, {
      action: AUDIT_ACTION.SAVED_REPORT_CREATED,
      entityType: "SavedReport",
      entityId: created.id,
      meta: {
        name: created.name,
        dimensions: config.dimensions,
        measures: config.measures,
      },
    });

    return ok(
      {
        id: created.id,
        name: created.name,
        description: created.description,
        createdAt: created.createdAt,
        lastRunAt: created.lastRunAt,
        config,
      },
      201,
    );
  },
);

/** Reference to keep zod schema reachable for tests / future imports. */
export const __schema = ReportConfigSchema;
