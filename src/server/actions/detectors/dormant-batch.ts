/**
 * Detector: DORMANT_BATCH.
 *
 * Splits dormant patients into three age buckets ("90-180", "180-365",
 * "365+") and emits one action per bucket whose count meets the
 * `dormantBatchMin` threshold AND was not targeted by a campaign in the last
 * `dormantCampaignCooldownDays` days.
 *
 *   - "Dormant" = `Patient.lastVisitAt` strictly older than
 *     `now - dormantMinDays`. Patients without `lastVisitAt` (never visited)
 *     are not dormant by this definition — they're leads.
 *   - We exclude patients who have any future-dated appointment so we don't
 *     nudge people already coming back.
 *   - "Campaign" = a `NotificationSend` with `campaignId IS NOT NULL` whose
 *     row body / template suggests a dormant-segment audience. We don't have
 *     a structured "campaign segment" column today, so the cooldown check
 *     uses `Campaign.segment` JSON path "kind" = "dormant".
 *
 * Severity: `medium` (default). The bucket label travels in the payload.
 */
import type { DormantBatchPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays } from "./_shared";

type Segment = "90-180" | "180-365" | "365+";

function bucketFor(daysSinceVisit: number): Segment | null {
  if (daysSinceVisit < 90) return null;
  if (daysSinceVisit <= 180) return "90-180";
  if (daysSinceVisit <= 365) return "180-365";
  return "365+";
}

export async function detectDormantBatch(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<DormantBatchPayload[]> {
  const cutoff = addDays(now, -config.dormantMinDays);

  const patients = (await prisma.patient.findMany({
    where: { lastVisitAt: { lt: cutoff, not: null } },
    select: { id: true, lastVisitAt: true },
  })) as Array<{ id: string; lastVisitAt: Date | null }>;
  if (patients.length === 0) return [];

  const patientIds = patients.map((p) => p.id);

  // Patients with future appointments — exclude from dormant counting.
  const futureRows = (await prisma.appointment.findMany({
    where: {
      patientId: { in: patientIds },
      date: { gt: now },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { patientId: true },
  })) as Array<{ patientId: string }>;
  const futureSet = new Set(futureRows.map((r) => r.patientId));

  const counts: Record<Segment, number> = {
    "90-180": 0,
    "180-365": 0,
    "365+": 0,
  };
  for (const p of patients) {
    if (!p.lastVisitAt) continue;
    if (futureSet.has(p.id)) continue;
    const days = Math.floor(
      (now.getTime() - p.lastVisitAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    const seg = bucketFor(days);
    if (!seg) continue;
    counts[seg] += 1;
  }

  // Cooldown: pull recent campaigns whose segment.kind = "dormant".
  const cooldownStart = addDays(now, -config.dormantCampaignCooldownDays);
  type CampaignRow = {
    id: string;
    segment: unknown;
    createdAt: Date;
    scheduledFor: Date | null;
    startedAt: Date | null;
  };
  const campaigns = (await prisma.campaign.findMany({
    where: {
      OR: [
        { startedAt: { gte: cooldownStart } },
        { scheduledFor: { gte: cooldownStart } },
        { createdAt: { gte: cooldownStart } },
      ],
    },
    select: {
      id: true,
      segment: true,
      createdAt: true,
      scheduledFor: true,
      startedAt: true,
    },
  })) as CampaignRow[];

  // Per-segment lastCampaignAt mapping.
  const lastCampaignBySegment: Record<Segment, Date | null> = {
    "90-180": null,
    "180-365": null,
    "365+": null,
  };
  for (const c of campaigns) {
    if (!c.segment || typeof c.segment !== "object") continue;
    const seg = c.segment as { kind?: unknown; bucket?: unknown };
    if (seg.kind !== "dormant") continue;
    const bucket = typeof seg.bucket === "string" ? (seg.bucket as Segment) : null;
    const candidates: Segment[] = bucket
      ? [bucket]
      : ["90-180", "180-365", "365+"];
    const ts = c.startedAt ?? c.scheduledFor ?? c.createdAt;
    for (const s of candidates) {
      const cur = lastCampaignBySegment[s];
      if (!cur || ts.getTime() > cur.getTime()) {
        lastCampaignBySegment[s] = ts;
      }
    }
  }

  const out: DormantBatchPayload[] = [];
  for (const seg of ["90-180", "180-365", "365+"] as Segment[]) {
    const count = counts[seg];
    if (count < config.dormantBatchMin) continue;
    const last = lastCampaignBySegment[seg];
    // Cooldown: skip if a recent campaign for this segment exists.
    if (last && last.getTime() >= cooldownStart.getTime()) continue;
    out.push({
      type: "DORMANT_BATCH",
      segment: seg,
      patientCount: count,
      lastCampaignAt: last ? last.toISOString() : null,
    });
  }
  return out;
}
