/**
 * Broadcast audience resolver.
 *
 * Generalises `dormant-audience.ts` to the full broadcast ("рассылка") segment
 * union. `resolveAudience` dispatches by `segment.kind`:
 *
 *   - `dormant` → delegates to `resolveDormantAudience` (unchanged reactivation
 *     path: bucket window + future-appointment exclusion).
 *   - `all` / `segment` / `tag` → an ad-hoc broadcast over the whole clinic
 *     filtered by the same eligibility gates the dormant path uses, MINUS the
 *     future-appointment exclusion (a broadcast is a general announcement; you
 *     still want to reach patients who happen to have an upcoming visit).
 *
 * Shared eligibility gates (all kinds):
 *   1. Patient is not soft-deleted (`deletedAt IS NULL`).
 *   2. Patient passes the marketing consent gate — broadcasts are marketing
 *      messages per `consent-gate.ts`, so `marketingOptOut` is honoured.
 *   3. Patient has a Telegram id (campaigns are TG-only after
 *      `docs/TZ-sms-removal.md` Wave 3).
 *
 * The returned `AudienceResolution` is the exact shape the launcher
 * materialises NotificationSend rows from, so the composer's live preview count
 * matches the number of sends that actually fire. Every gate is SQL, applied
 * before the `MAX_AUDIENCE` limit; a bigger audience is reported as
 * `truncated` and refused at launch, never cut silently (audit TG-10).
 */
import { prisma } from "@/lib/prisma";

import {
  resolveDormantAudience,
  resolveReachable,
  type AudienceResolution,
} from "./dormant-audience";
import type { CampaignChannel, CampaignSegment } from "@/server/schemas/campaign";

export type { AudiencePatient, AudienceResolution } from "./dormant-audience";

/**
 * Build the `where` filter for the non-dormant broadcast kinds. `deletedAt`
 * null is always applied; the kind narrows by lifecycle segment or tags.
 */
function broadcastWhere(
  segment: Extract<CampaignSegment, { kind: "all" | "segment" | "tag" }>,
): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (segment.kind === "segment") {
    where.segment = { in: segment.segments };
  } else if (segment.kind === "tag") {
    where.tags = { hasSome: segment.tags };
  }
  return where;
}

export async function resolveAudience(args: {
  segment: CampaignSegment;
  channel: CampaignChannel;
  now?: Date;
}): Promise<AudienceResolution> {
  const { segment, channel } = args;

  if (segment.kind === "dormant") {
    return resolveDormantAudience({
      bucket: segment.bucket,
      channel,
      now: args.now,
    });
  }

  // Consent, Telegram and block gates run in SQL before the row limit
  // (audit TG-10): they used to run in memory over the first 10 000 cards.
  return resolveReachable(
    prisma as unknown as Parameters<typeof resolveReachable>[0],
    broadcastWhere(segment),
  );
}
