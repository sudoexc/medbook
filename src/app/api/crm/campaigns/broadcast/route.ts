/**
 * POST /api/crm/campaigns/broadcast — one-shot "рассылка" from the Telegram
 * section: create a DRAFT Campaign with an inline body + audience segment, then
 * launch it in the same request. ADMIN-only, audited as CAMPAIGN_BROADCAST.
 *
 * `scheduledFor` in the future defers delivery to the notifications scheduler
 * (the launcher materialises QUEUED rows but skips the immediate enqueue).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { BroadcastSchema } from "@/server/schemas/campaign";
import type { CampaignSegment } from "@/server/schemas/campaign";
import { launchCampaign } from "@/server/campaigns/launch";

function defaultName(now: Date): string {
  const stamp = now.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Рассылка · ${stamp}`;
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: BroadcastSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const now = new Date();
    const name = body.name?.trim() || defaultName(now);
    const segment = body.segment as CampaignSegment;
    const scheduledFor =
      body.scheduledFor && body.scheduledFor.getTime() > now.getTime()
        ? body.scheduledFor
        : null;

    const created = await prisma.campaign.create({
      data: {
        clinicId: ctx.clinicId,
        name,
        channel: body.channel,
        body: body.body,
        segment: segment as never,
        scheduledFor,
        status: "DRAFT",
        createdById: ctx.userId,
      },
    });

    try {
      const result = await launchCampaign({ campaignId: created.id, now });

      await audit(request, {
        action: AUDIT_ACTION.CAMPAIGN_BROADCAST,
        entityType: "Campaign",
        entityId: created.id,
        meta: {
          name,
          channel: body.channel,
          segment,
          totalCount: result.totalCount,
          scheduledFor: result.scheduledFor,
          deferred: result.deferred,
        },
      });

      return ok(
        {
          campaignId: created.id,
          status: result.status,
          totalCount: result.totalCount,
          scheduledFor: result.scheduledFor,
          deferred: result.deferred,
        },
        201,
      );
    } catch (e) {
      // Launch failed after the DRAFT was created — surface the error; the
      // orphan DRAFT carries zero sends and can be re-launched or ignored.
      const status = (e as Error & { status?: number }).status ?? 500;
      const message = e instanceof Error ? e.message : String(e);
      return err(message, status);
    }
  },
);
