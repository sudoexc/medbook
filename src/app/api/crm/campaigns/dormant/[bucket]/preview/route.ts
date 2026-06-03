/**
 * GET /api/crm/campaigns/dormant/[bucket]/preview — audience preview for the
 * Реактивация wizard. Returns total + per-channel reachability + the first N
 * patient names so the admin can sanity-check who they're about to message.
 *
 * The audience filter mirrors the actual launch — same patient selection,
 * same consent gate, same channel eligibility.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok, parseQuery, err } from "@/server/http";
import { z } from "zod";

import {
  CampaignChannelEnum,
  DormantBucketEnum,
} from "@/server/schemas/campaign";
import { resolveDormantAudience } from "@/server/campaigns/dormant-audience";

const PreviewQuerySchema = z.object({
  channel: CampaignChannelEnum.default("TG"),
  sampleSize: z.coerce.number().int().min(0).max(20).default(8),
});

function bucketFromUrl(request: Request): string {
  // /api/crm/campaigns/dormant/<bucket>/preview — bucket is second-to-last.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ request }) => {
    const rawBucket = bucketFromUrl(request);
    const bucket = DormantBucketEnum.safeParse(rawBucket);
    if (!bucket.success) return err("InvalidBucket", 400);

    const parsed = parseQuery(request, PreviewQuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const res = await resolveDormantAudience({
      bucket: bucket.data,
      channel: q.channel,
    });

    const sample = res.patients.slice(0, q.sampleSize).map((p) => ({
      id: p.id,
      fullName: p.fullName,
      preferredLang: p.preferredLang,
      lastVisitAt: p.lastVisitAt?.toISOString() ?? null,
    }));

    return ok({
      bucket: bucket.data,
      channel: q.channel,
      total: res.total,
      eligible: res.eligible,
      channelBreakdown: res.channelBreakdown,
      sample,
    });
  },
);
