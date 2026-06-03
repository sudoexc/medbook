/**
 * POST /api/crm/campaigns/[id]/launch — flip DRAFT → SENDING, materialise
 * NotificationSend rows for the resolved audience, optionally close the
 * source Action Center action that surfaced this campaign.
 *
 * Idempotent: a second click on an already-launched campaign returns 200 with
 * `alreadyLaunched: true`.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { LaunchCampaignSchema } from "@/server/schemas/campaign";
import { launchCampaign } from "@/server/campaigns/launch";

function campaignIdFromUrl(request: Request): string {
  // /api/crm/campaigns/<id>/launch — id is the second-to-last segment.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: LaunchCampaignSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const id = campaignIdFromUrl(request);
    if (!id) return notFound();

    const before = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, status: true, segment: true, name: true, channel: true, templateId: true },
    });
    if (!before) return notFound();

    try {
      const result = await launchCampaign({
        campaignId: id,
        sourceActionId: body.sourceActionId ?? null,
      });

      if (!result.alreadyLaunched) {
        await audit(request, {
          action: AUDIT_ACTION.CAMPAIGN_LAUNCHED,
          entityType: "Campaign",
          entityId: id,
          meta: {
            name: before.name,
            channel: before.channel,
            templateId: before.templateId,
            segment: before.segment,
            totalCount: result.totalCount,
            sourceActionId: body.sourceActionId ?? null,
            status: result.status,
          },
        });
      }

      return ok(result);
    } catch (e) {
      const status = (e as Error & { status?: number }).status ?? 500;
      const message = e instanceof Error ? e.message : String(e);
      return err(message, status);
    }
  },
);
