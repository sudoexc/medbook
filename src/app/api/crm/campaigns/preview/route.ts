/**
 * POST /api/crm/campaigns/preview — resolve a broadcast audience and return a
 * live recipient count + reachability breakdown + a small sample. Drives the
 * broadcast composer's debounced "получат N человек" indicator.
 *
 * Accepts the full segment union (`all` / `segment` / `tag` / `dormant`) so the
 * count shown here matches exactly what the launcher would materialise.
 */
import { createApiHandler } from "@/lib/api-handler";
import { ok, err } from "@/server/http";
import { PreviewAudienceSchema } from "@/server/schemas/campaign";
import { resolveAudience } from "@/server/campaigns/audience";

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"], bodySchema: PreviewAudienceSchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const res = await resolveAudience({
      segment: body.segment,
      channel: body.channel,
    });

    const sample = res.patients.slice(0, 8).map((p) => ({
      id: p.id,
      fullName: p.fullName,
      preferredLang: p.preferredLang,
      lastVisitAt: p.lastVisitAt,
    }));

    return ok({
      channel: body.channel,
      total: res.total,
      eligible: res.eligible,
      channelBreakdown: res.channelBreakdown,
      sample,
    });
  },
);
