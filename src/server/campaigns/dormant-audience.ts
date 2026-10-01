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
 *   4. Patient passes the marketing consent gate (`marketingOptOut = false`,
 *      the SQL form of `isAllowedToReceive(..., 'marketing')`).
 *   5. Patient has a Telegram id and has not blocked the bot (campaigns are
 *      TG-only after `docs/TZ-sms-removal.md` Wave 3).
 *
 * Every gate runs in SQL before the row limit (audit TG-10).
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
  noChannel: number;
  optedOut: number;
  /** Has a Telegram id but blocked the bot — excluded from the send audience. */
  blocked: number;
};

export type AudienceResolution = {
  patients: AudiencePatient[];
  total: number;
  eligible: number;
  channelBreakdown: AudienceChannelBreakdown;
  /**
   * More patients qualify than one broadcast may carry (`limit`). The
   * launcher refuses such a campaign instead of quietly sending to the
   * first `limit` (audit TG-10); the preview says so.
   */
  truncated: boolean;
  limit: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The most sends one broadcast materialises. */
export const MAX_AUDIENCE = 10_000;

type PatientWhere = Record<string, unknown>;

/**
 * Audit TG-10: the reachability gates as SQL, applied BEFORE the row limit.
 * They used to run in memory over the first N cards by `lastVisitAt desc`
 * (NULLs first in Postgres), so a big clinic's broadcast reached only the
 * Telegram patients who happened to sit in that slice while the preview
 * reported it as everyone.
 */
const HAS_TELEGRAM: PatientWhere = {
  AND: [{ telegramId: { not: null } }, { NOT: { telegramId: "" } }],
};
const NO_TELEGRAM: PatientWhere = {
  OR: [{ telegramId: null }, { telegramId: "" }],
};

/** Reachable: marketing allowed, a Telegram chat, the bot not blocked. */
export function reachableWhere(base: PatientWhere): PatientWhere {
  return {
    AND: [base, { marketingOptOut: false }, HAS_TELEGRAM, { tgBlockedAt: null }],
  };
}

type CountDb = {
  patient: {
    count: (args: { where: PatientWhere }) => Promise<number>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
};

/**
 * Count every bucket and load the reachable patients, all in SQL: the
 * breakdown («нет Telegram», «отписались», «заблокировали бота») is exact
 * however big the clinic, and the list stops at `MAX_AUDIENCE` reachable
 * patients, not cards.
 */
export async function resolveReachable(
  db: CountDb,
  base: PatientWhere,
): Promise<AudienceResolution> {
  const [total, optedOut, noChannel, blocked, eligible, rows] = await Promise.all([
    db.patient.count({ where: base }),
    db.patient.count({ where: { AND: [base, { marketingOptOut: true }] } }),
    db.patient.count({
      where: { AND: [base, { marketingOptOut: false }, NO_TELEGRAM] },
    }),
    db.patient.count({
      where: {
        AND: [base, { marketingOptOut: false }, HAS_TELEGRAM, { tgBlockedAt: { not: null } }],
      },
    }),
    db.patient.count({ where: reachableWhere(base) }),
    db.patient.findMany({
      where: reachableWhere(base),
      select: {
        id: true,
        fullName: true,
        phone: true,
        telegramId: true,
        preferredLang: true,
        lastVisitAt: true,
      },
      orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: MAX_AUDIENCE,
    }),
  ]);
  const patients = (rows as AudiencePatient[]).map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    telegramId: p.telegramId ?? null,
    preferredLang: p.preferredLang,
    lastVisitAt: p.lastVisitAt ?? null,
  }));
  return {
    patients,
    total,
    eligible,
    channelBreakdown: { tgReady: eligible, noChannel, optedOut, blocked },
    truncated: eligible > MAX_AUDIENCE,
    limit: MAX_AUDIENCE,
  };
}

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
 * `channel` exists for forward-compat with future segment kinds; today
 * the only campaign channel is "TG" (see
 * `docs/TZ-sms-removal.md`). The returned `channelBreakdown` surfaces
 * "X via TG / Y without any reachable channel / Z opted out" so the
 * wizard preview can warn the operator before launch.
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

  // Patients already coming back are not dormant: the exclusion is part of
  // the base set (SQL), not a post-filter over a truncated list (audit
  // TG-10 — it used to run over the first 5 000 cards only).
  const base: PatientWhere = {
    lastVisitAt: cutoffMax
      ? { lte: cutoffMin, gt: cutoffMax }
      : { lte: cutoffMin },
    deletedAt: null,
    appointments: {
      none: {
        date: { gt: now },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    },
  };

  return resolveReachable(prisma as unknown as CountDb, base);
}
