/**
 * /api/crm/actions/sla — response-time SLA breakdown for the action-center
 * right-rail.
 *
 * Buckets the past 7 days of `NotificationSend` rows by channel and reports
 * the average latency between `scheduledFor` (when the operator triggered
 * the send) and `sentAt` (when adapters finished). The aggregate stat
 * (`overall`) is the unweighted mean of all delivered rows.
 *
 *   - telegram → channel = "TG"
 *   - feedback → channel = "EMAIL" (NPS / surveys piggy-back on email)
 *   - calls    → channel = "CALL" (operator outbound dial; still inserted
 *                                   even when SIP isn't wired, so this
 *                                   captures the response cadence)
 *
 * If a bucket has zero data points we return `null` for `avgSeconds`; the
 * UI shows an em-dash instead of a misleading 0:00.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

type BucketStat = { avgSeconds: number | null; samples: number };

const WINDOW_DAYS = 7;

async function avgLatency(
  channels: Array<"TG" | "EMAIL" | "CALL" | "INAPP" | "VISIT">,
  since: Date,
): Promise<BucketStat> {
  const rows = await prisma.notificationSend.findMany({
    where: {
      channel: { in: channels },
      scheduledFor: { gte: since },
      sentAt: { not: null },
    },
    select: { scheduledFor: true, sentAt: true },
    take: 5000,
  });
  if (rows.length === 0) return { avgSeconds: null, samples: 0 };
  let totalMs = 0;
  for (const r of rows) {
    if (!r.sentAt) continue;
    const delta = r.sentAt.getTime() - r.scheduledFor.getTime();
    if (delta >= 0) totalMs += delta;
  }
  const avgSeconds = Math.round(totalMs / rows.length / 1000);
  return { avgSeconds, samples: rows.length };
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR", "DOCTOR"] },
  async () => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [telegram, feedback, calls] = await Promise.all([
      avgLatency(["TG"], since),
      avgLatency(["EMAIL"], since),
      avgLatency(["CALL"], since),
    ]);

    const totalSamples =
      telegram.samples + feedback.samples + calls.samples;
    let overallAvg: number | null = null;
    if (totalSamples > 0) {
      const weighted =
        (telegram.avgSeconds ?? 0) * telegram.samples +
        (feedback.avgSeconds ?? 0) * feedback.samples +
        (calls.avgSeconds ?? 0) * calls.samples;
      overallAvg = Math.round(weighted / totalSamples);
    }

    return ok({
      windowDays: WINDOW_DAYS,
      overall: { avgSeconds: overallAvg, samples: totalSamples },
      telegram,
      feedback,
      calls,
    });
  },
);
