/**
 * Reactivation campaign audience resolver.
 *
 * Mirrors the filtering inside `detectors/dormant-batch.ts` so the audience
 * shown in the wizard preview is exactly the audience that gets
 * NotificationSend rows materialised at launch:
 *
 *   1. `lastVisitAt` is set AND falls inside the bucket window.
 *   2. No future-dated, non-cancelled appointment (they're already coming back).
 *   3. Patient is not soft-deleted (`deletedAt IS NULL`).
 *   4. Patient passes the marketing consent gate
 *      (`isAllowedToReceive(..., 'marketing')`).
 *   5. Patient has the relevant recipient address for the chosen channel
 *      (telegramId for TG, phoneNormalized for SMS).
 *
 * The detector runs filter #1 + #2 against the WHOLE clinic, so the
 * audience returned here is always a subset. The detector's own cooldown
 * (skip if a campaign already fired for this bucket in the last
 * `dormantCampaignCooldownDays`) is NOT replicated here — the wizard is the
 * caller's explicit decision to fire a campaign anyway. The DORMANT_BATCH
 * action will be re-emitted on the next detector pass with the updated
 * `lastCampaignAt`.
 */
import { prisma } from "@/lib/prisma";
import { isAllowedToReceive } from "@/server/notifications/consent-gate";

import type { CampaignChannel, DormantBucket } from "@/server/schemas/campaign";

export type AudiencePatient = {
  id: string;
  fullName: string;
  phone: string;
  telegramId: string | null;
  preferredLang: "RU" | "UZ";
  lastVisitAt: Date | null;
};

export type AudienceChannelBreakdown = {
  tgReady: number;
  smsReady: number;
  noChannel: number;
  optedOut: number;
};

export type AudienceResolution = {
  patients: AudiencePatient[];
  total: number;
  eligible: number;
  channelBreakdown: AudienceChannelBreakdown;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function bucketWindow(bucket: DormantBucket, now: Date): {
  minDays: number;
  maxDays: number | null;
} {
  switch (bucket) {
    case "90-180":
      return { minDays: 90, maxDays: 180 };
    case "180-365":
      return { minDays: 180, maxDays: 365 };
    case "365+":
      return { minDays: 365, maxDays: null };
  }
}

/**
 * Resolve the patient list that matches a dormant bucket for a clinic.
 *
 * `channel` is used only for the channel-eligibility filter; the returned
 * `channelBreakdown` is always computed for both channels so the UI can show
 * "X via TG / Y via SMS / Z without any reachable channel" regardless of the
 * current pick.
 */
export async function resolveDormantAudience(args: {
  bucket: DormantBucket;
  channel: CampaignChannel;
  now?: Date;
}): Promise<AudienceResolution> {
  const now = args.now ?? new Date();
  const { minDays, maxDays } = bucketWindow(args.bucket, now);

  // Patients last seen between (now - maxDays) and (now - minDays). For "365+"
  // there is no upper bound on the lookback — just `lastVisitAt < cutoffMin`.
  const cutoffMin = new Date(now.getTime() - minDays * MS_PER_DAY);
  const cutoffMax = maxDays === null ? null : new Date(now.getTime() - maxDays * MS_PER_DAY);

  const where: Record<string, unknown> = {
    lastVisitAt: cutoffMax
      ? { lte: cutoffMin, gt: cutoffMax }
      : { lte: cutoffMin },
    deletedAt: null,
  };

  const candidates = await prisma.patient.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramId: true,
      preferredLang: true,
      lastVisitAt: true,
      marketingOptOut: true,
    },
    orderBy: { lastVisitAt: "desc" },
    take: 5000,
  });

  if (candidates.length === 0) {
    return {
      patients: [],
      total: 0,
      eligible: 0,
      channelBreakdown: { tgReady: 0, smsReady: 0, noChannel: 0, optedOut: 0 },
    };
  }

  // Exclude patients already coming back.
  const candidateIds = candidates.map((p) => p.id);
  const futureRows = await prisma.appointment.findMany({
    where: {
      patientId: { in: candidateIds },
      date: { gt: now },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { patientId: true },
  });
  const futureSet = new Set(futureRows.map((r) => r.patientId));

  const breakdown: AudienceChannelBreakdown = {
    tgReady: 0,
    smsReady: 0,
    noChannel: 0,
    optedOut: 0,
  };

  const audience: AudiencePatient[] = [];
  for (const p of candidates) {
    if (futureSet.has(p.id)) continue;

    const consent = isAllowedToReceive(
      { marketingOptOut: p.marketingOptOut, deletedAt: null },
      "marketing",
    );
    if (!consent.allowed) {
      if (consent.reason === "opted_out") breakdown.optedOut += 1;
      continue;
    }

    const hasTg = (p.telegramId ?? "").length > 0;
    const hasSms = (p.phone ?? "").length > 0;
    if (hasTg) breakdown.tgReady += 1;
    if (hasSms) breakdown.smsReady += 1;
    if (!hasTg && !hasSms) {
      breakdown.noChannel += 1;
      continue;
    }

    // Channel-specific eligibility for the resulting audience list.
    if (args.channel === "TG" && !hasTg) continue;
    if (args.channel === "SMS" && !hasSms) continue;

    audience.push({
      id: p.id,
      fullName: p.fullName,
      phone: p.phone,
      telegramId: p.telegramId ?? null,
      preferredLang: p.preferredLang as "RU" | "UZ",
      lastVisitAt: p.lastVisitAt ?? null,
    });
  }

  return {
    patients: audience,
    total: candidates.length - futureSet.size,
    eligible: audience.length,
    channelBreakdown: breakdown,
  };
}
