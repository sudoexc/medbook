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
 * matches the number of sends that actually fire.
 */
import { prisma } from "@/lib/prisma";
import { isAllowedToReceive } from "@/server/notifications/consent-gate";

import {
  resolveDormantAudience,
  type AudiencePatient,
  type AudienceChannelBreakdown,
  type AudienceResolution,
} from "./dormant-audience";
import type { CampaignChannel, CampaignSegment } from "@/server/schemas/campaign";

export type { AudiencePatient, AudienceResolution } from "./dormant-audience";

// Bounded fetch — a single broadcast materialises at most this many sends.
const MAX_AUDIENCE = 10_000;

type CandidateRow = {
  id: string;
  fullName: string;
  phone: string;
  telegramId: string | null;
  preferredLang: "RU" | "UZ";
  lastVisitAt: Date | null;
  marketingOptOut: boolean;
  tgBlockedAt: Date | null;
};

/**
 * Apply the consent + channel gates to a candidate list and tally the
 * breakdown. Shared by every non-dormant broadcast kind.
 */
function filterEligible(
  candidates: CandidateRow[],
  channel: CampaignChannel,
): AudienceResolution {
  const breakdown: AudienceChannelBreakdown = {
    tgReady: 0,
    noChannel: 0,
    optedOut: 0,
    blocked: 0,
  };
  const audience: AudiencePatient[] = [];

  for (const p of candidates) {
    const consent = isAllowedToReceive(
      { marketingOptOut: p.marketingOptOut, deletedAt: null },
      "marketing",
    );
    if (!consent.allowed) {
      if (consent.reason === "opted_out") breakdown.optedOut += 1;
      continue;
    }

    const hasTg = (p.telegramId ?? "").length > 0;
    if (!hasTg) {
      breakdown.noChannel += 1;
      continue;
    }
    // Blocked the bot — a send would just FAIL with 403, so drop them.
    if (p.tgBlockedAt) {
      breakdown.blocked += 1;
      continue;
    }
    if (channel === "TG") breakdown.tgReady += 1;

    audience.push({
      id: p.id,
      fullName: p.fullName,
      phone: p.phone,
      telegramId: p.telegramId ?? null,
      preferredLang: p.preferredLang,
      lastVisitAt: p.lastVisitAt ?? null,
    });
  }

  return {
    patients: audience,
    total: candidates.length,
    eligible: audience.length,
    channelBreakdown: breakdown,
  };
}

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

  const candidates = (await prisma.patient.findMany({
    where: broadcastWhere(segment),
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramId: true,
      preferredLang: true,
      lastVisitAt: true,
      marketingOptOut: true,
      tgBlockedAt: true,
    },
    orderBy: { lastVisitAt: "desc" },
    take: MAX_AUDIENCE,
  })) as CandidateRow[];

  return filterEligible(candidates, channel);
}
