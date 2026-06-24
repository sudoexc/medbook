/**
 * /api/crm/campaigns — list + create.
 *
 * `GET`  — paginated campaigns for the active clinic, newest first.
 * `POST` — create a DRAFT campaign. Body is launched separately via
 *          `/api/crm/campaigns/[id]/launch`.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery, err } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  CreateCampaignSchema,
  QueryCampaignsSchema,
} from "@/server/schemas/campaign";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryCampaignsSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;

    const take = q.limit + 1;
    const rows = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        template: { select: { id: true, nameRu: true, nameUz: true, key: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateCampaignSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // Template-backed campaigns only (the dormant wizard). Inline-body
    // broadcasts go through POST /api/crm/campaigns/broadcast instead.
    if (!body.templateId) return err("TemplateRequired", 400);

    const template = await prisma.notificationTemplate.findUnique({
      where: { id: body.templateId },
      select: { id: true, channel: true, isActive: true },
    });
    if (!template) {
      return err("TemplateNotFound", 404);
    }
    if (template.channel !== body.channel) {
      return err("TemplateChannelMismatch", 400, {
        templateChannel: template.channel,
        wantedChannel: body.channel,
      });
    }

    const created = await prisma.campaign.create({
      data: {
        clinicId: ctx.clinicId,
        name: body.name,
        channel: body.channel,
        templateId: body.templateId,
        segment: body.segment as never,
        status: "DRAFT",
        createdById: ctx.userId,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.CAMPAIGN_CREATED,
      entityType: "Campaign",
      entityId: created.id,
      meta: {
        name: created.name,
        channel: created.channel,
        templateId: created.templateId,
        segment: body.segment,
      },
    });

    return ok(created, 201);
  },
);
