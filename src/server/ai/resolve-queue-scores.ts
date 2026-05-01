/**
 * Phase 10 — server resolver for the receptionist queue score.
 *
 * Loads today's BOOKED / WAITING / IN_PROGRESS appointments (auto-scoped to
 * the current TenantContext via the Prisma extension), enriches each with
 * derived signals (waitMin, urgency, VIP, no-show risk), and returns them
 * sorted by `computeQueueScore` descending.
 *
 * The function relies on the AsyncLocalStorage tenant scope — callers must
 * be inside `runWithTenant` (the api-handler does this for us). Branch
 * scoping is also automatic: when `ctx.branchId` is set, the Appointment
 * model is filtered to that branch.
 */

import { prisma } from "@/lib/prisma";
import {
  computeQueueScore,
  type QueueScoreOutput,
} from "@/lib/ai/queue-score";
import { computeNoShowRisk } from "@/lib/ai/no-show-risk";

export interface ScoredAppointment {
  appointmentId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  serviceCode: string | null;
  serviceName: string | null;
  scheduledAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  queueStatus: string;
  waitMin: number;
  isVip: boolean;
  noShowRisk: number;
  score: QueueScoreOutput;
}

const URGENT_RE = /urgent|emerg/i;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function urgencyFromCode(code: string | null | undefined): 0 | 1 | 2 | 3 {
  if (!code) return 0;
  return URGENT_RE.test(code) ? 3 : 0;
}

function diffMin(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 60_000);
}

export interface ResolveQueueScoresOptions {
  now?: Date;
  /**
   * When true, IN_PROGRESS rows are included with `waitMin` measured from
   * `startedAt` so the dashboard can flag long-running visits. Defaults to
   * true — the UI sorts them naturally near the top via score.
   */
  includeInProgress?: boolean;
}

export async function resolveQueueScores(
  opts: ResolveQueueScoresOptions = {},
): Promise<ScoredAppointment[]> {
  const now = opts.now ?? new Date();
  const includeInProgress = opts.includeInProgress ?? true;

  const statuses = includeInProgress
    ? (["BOOKED", "WAITING", "IN_PROGRESS"] as const)
    : (["BOOKED", "WAITING"] as const);

  const rows = await prisma.appointment.findMany({
    where: {
      date: { gte: startOfDay(now), lte: endOfDay(now) },
      queueStatus: { in: statuses as unknown as string[] } as never,
    },
    include: {
      patient: {
        select: {
          id: true,
          fullName: true,
          segment: true,
          visitsCount: true,
        },
      },
      primaryService: {
        select: { id: true, code: true, nameRu: true, durationMin: true },
      },
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    take: 200,
  });

  if (rows.length === 0) return [];

  // Per-patient no-show count for the same day window. Cheap aggregation —
  // small N due to the take cap above.
  const patientIds = Array.from(new Set(rows.map((r) => r.patientId)));
  const noShowCounts = new Map<string, number>();
  if (patientIds.length > 0) {
    const groups = await prisma.appointment.groupBy({
      by: ["patientId"],
      where: {
        patientId: { in: patientIds },
        status: "NO_SHOW" as never,
      },
      _count: { _all: true },
    });
    for (const g of groups) {
      noShowCounts.set(g.patientId, g._count._all);
    }
  }

  const scored: ScoredAppointment[] = rows.map((row) => {
    const calledAt = row.calledAt ?? null;
    const startedAt = row.startedAt ?? null;
    const scheduled = row.date;

    let waitMin = 0;
    if (startedAt && row.queueStatus === "IN_PROGRESS") {
      waitMin = diffMin(now, startedAt);
    } else if (calledAt) {
      waitMin = diffMin(now, calledAt);
    } else {
      waitMin = diffMin(now, scheduled);
    }

    const totalVisits = row.patient?.visitsCount ?? 0;
    const noShows = noShowCounts.get(row.patientId) ?? 0;
    const hoursToAppointment = Math.max(
      0,
      (scheduled.getTime() - now.getTime()) / 3_600_000,
    );
    const isFirstVisit = totalVisits === 0;
    const ns = computeNoShowRisk({
      totalVisits,
      noShows,
      hasUnconfirmedReminder: false,
      hoursToAppointment,
      isFirstVisit,
    });

    const isVip = row.patient?.segment === "VIP";
    const isLate = !!(calledAt && scheduled.getTime() < now.getTime() - 60_000);
    const urgency = urgencyFromCode(row.primaryService?.code ?? null);

    const score = computeQueueScore({
      waitMin,
      urgencyLevel: urgency,
      isVip,
      noShowRisk: ns.risk,
      isLate,
      hasOverdue: false,
    });

    return {
      appointmentId: row.id,
      doctorId: row.doctorId,
      patientId: row.patientId,
      patientName: row.patient?.fullName ?? "",
      serviceCode: row.primaryService?.code ?? null,
      serviceName: row.primaryService?.nameRu ?? null,
      scheduledAt: scheduled,
      calledAt,
      startedAt,
      queueStatus: row.queueStatus,
      waitMin,
      isVip,
      noShowRisk: ns.risk,
      score,
    };
  });

  scored.sort((a, b) => b.score.score - a.score.score);
  return scored;
}
