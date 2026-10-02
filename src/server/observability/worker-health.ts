/**
 * The workers check of `/api/health` (audit INF-01).
 *
 * Two sources, because "the process is up" and "the work gets done" fail
 * differently:
 *   - heartbeats the worker writes to Redis (`worker-heartbeat.ts`): no or
 *     a stopped process beat is `down`, a loop two ticks late `degraded`;
 *   - the tables the worker drains: an outbox row undelivered for over a
 *     minute, an event dead-lettered in the last day, a due notification
 *     still QUEUED after half an hour, a patient document (conclusion PDF,
 *     medication courses, referral PDF) still not produced half an hour
 *     after it became due are `degraded`.
 *
 * The result is cached for 10 s: the probe is public and unthrottled, and
 * the docker healthcheck, the watchdog and uptime monitors all poll it.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  CONCLUSION_BACKFILL_WINDOW_MS,
  hasDeliverableHandout,
} from "@/server/visit-notes/conclusion-delivery";

import { evaluateHeartbeats, readHeartbeats } from "./worker-heartbeat";

const CHECK_TIMEOUT_MS = 5_000;

/** An outbox row still undelivered after this is a stuck pumper. */
export const OUTBOX_PENDING_MAX_SEC = 60;
/** A due notification still QUEUED after this is a stuck send pipeline
 *  (its own retries settle within minutes). */
export const NOTIFICATION_OVERDUE_MAX_SEC = 30 * 60;
/**
 * A patient document the sweeps still have not produced this long after it
 * became due (audit INF-16). The sweeps tick every 30 s and back off at most
 * hourly per broken row, so half an hour means it is failing, not queued.
 */
export const DOCUMENT_UNDELIVERED_MAX_SEC = 30 * 60;
/** Dead-lettered events this recent keep the workers check degraded. */
const DEAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const WORKERS_CACHE_MS = 10_000;

export type WorkersCheck = {
  status: "ok" | "degraded" | "down" | "not_configured" | "timeout";
  details?: string;
  processAgeSec?: number | null;
  staleLoops?: string[];
  loops?: number;
  outbox?: { oldestPendingSec: number | null; dead24h: number };
  notifications?: { oldestOverdueSec: number | null };
  documents?: { oldestUndeliveredSec: number | null };
};

function logCheckError(check: string, e: unknown): void {
  console.warn(`[health] ${check}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
}

export type Backlog = {
  oldestPendingSec: number | null;
  dead24h: number;
  oldestOverdueSec: number | null;
  /** Oldest due-but-missing patient document, past the 30 min grace. */
  oldestUndeliveredSec?: number | null;
};

/** What the worker left undone, read from the tables it drains. */
export async function readBacklog(now: Date): Promise<Backlog> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const [pending, dead24h, overdue] = await Promise.all([
      prisma.eventOutbox.findFirst({
        where: { status: { in: ["PENDING", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.eventOutbox.count({
        where: { status: "DEAD", createdAt: { gte: new Date(now.getTime() - DEAD_WINDOW_MS) } },
      }),
      prisma.notificationSend.findFirst({
        where: {
          status: "QUEUED",
          scheduledFor: { lte: new Date(now.getTime() - NOTIFICATION_OVERDUE_MAX_SEC * 1000) },
        },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
    ]);
    const ageSec = (d: Date | undefined) =>
      d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000)) : null;
    // Isolated: a failing documents query must not blank the outbox and
    // notification signals above.
    const undelivered = await oldestUndeliveredDocument(now).catch((e) => {
      logCheckError("workers.documents", e);
      return null;
    });
    return {
      oldestPendingSec: ageSec(pending?.createdAt),
      dead24h,
      oldestOverdueSec: ageSec(overdue?.scheduledFor),
      oldestUndeliveredSec: ageSec(undelivered ?? undefined),
    };
  });
}

/**
 * When the oldest patient document that should exist by now became due, or
 * null. Mirrors the three sweeps' own queries (conclusion PDF, medication
 * bridge, referral PDF) with a 30 min grace, so a row the worker keeps
 * failing on shows up here even though the worker only logs it.
 */
async function oldestUndeliveredDocument(now: Date): Promise<Date | null> {
  const dueBefore = new Date(now.getTime() - DOCUMENT_UNDELIVERED_MAX_SEC * 1000);
  const since = new Date(now.getTime() - CONCLUSION_BACKFILL_WINDOW_MS);
  const [firstRenders, staleRender, unbridged, referral] = await Promise.all([
    // A few rows, not one: a whitespace-only handout passes the not-null
    // filter but is never rendered, and must not count as stuck.
    prisma.visitNote.findMany({
      where: {
        status: "FINALIZED",
        patientHandoutMarkdown: { not: null },
        patient: { deletedAt: null },
        conclusionDocument: { is: null },
        finalizedAt: { gte: since, lte: dueBefore },
      },
      orderBy: { finalizedAt: "asc" },
      take: 10,
      select: { status: true, patientHandoutMarkdown: true, finalizedAt: true },
    }),
    prisma.visitNote.findFirst({
      where: {
        status: "FINALIZED",
        patientHandoutMarkdown: { not: null },
        patient: { deletedAt: null },
        handoutStaleAt: { lte: dueBefore },
      },
      orderBy: { handoutStaleAt: "asc" },
      select: { handoutStaleAt: true },
    }),
    // `updatedAt`, not `finalizedAt`: an in-window correction clears the
    // bridge anchor on an old note, and is due from that moment.
    prisma.visitNote.findFirst({
      where: {
        status: "FINALIZED",
        finalizedAt: { gte: since },
        medicationsBridgedAt: null,
        patient: { deletedAt: null },
        updatedAt: { lte: dueBefore },
      },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    }),
    prisma.referral.findFirst({
      where: {
        document: { is: null },
        patient: { deletedAt: null },
        createdAt: { gte: since, lte: dueBefore },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const candidates = [
    firstRenders.find((n) => hasDeliverableHandout(n))?.finalizedAt ?? null,
    staleRender?.handoutStaleAt ?? null,
    unbridged?.updatedAt ?? null,
    referral?.createdAt ?? null,
  ].filter((d): d is Date => d instanceof Date);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/**
 * Combine the heartbeat verdict and the backlog into the workers check.
 * Pure; exported for tests. `heartbeats` is null when Redis is not
 * configured (no channel between the app and the worker processes).
 */
export function workersVerdict(
  heartbeats: Record<string, string> | null,
  backlog: Backlog | null,
  now: number,
): WorkersCheck {
  const hb = heartbeats ? evaluateHeartbeats(heartbeats, now) : null;
  const backlogBad =
    backlog !== null &&
    ((backlog.oldestPendingSec !== null && backlog.oldestPendingSec > OUTBOX_PENDING_MAX_SEC) ||
      backlog.dead24h > 0 ||
      backlog.oldestOverdueSec !== null ||
      (backlog.oldestUndeliveredSec ?? null) !== null);
  const status: WorkersCheck["status"] =
    hb?.status === "down"
      ? "down"
      : hb?.status === "degraded" || backlogBad
        ? "degraded"
        : hb === null
          ? "not_configured"
          : "ok";
  return {
    status,
    ...(hb === null ? { details: "REDIS_URL unset, no worker heartbeat" } : {}),
    processAgeSec: hb?.processAgeSec ?? null,
    staleLoops: hb?.staleLoops ?? [],
    loops: hb?.loops ?? 0,
    ...(backlog
      ? {
          outbox: { oldestPendingSec: backlog.oldestPendingSec, dead24h: backlog.dead24h },
          notifications: { oldestOverdueSec: backlog.oldestOverdueSec },
          documents: { oldestUndeliveredSec: backlog.oldestUndeliveredSec ?? null },
        }
      : {}),
  };
}

let workersCache: { at: number; value: WorkersCheck } | null = null;

export async function checkWorkerHealth(): Promise<WorkersCheck> {
  const now = Date.now();
  if (workersCache && now - workersCache.at < WORKERS_CACHE_MS) return workersCache.value;
  const evaluate = async (): Promise<WorkersCheck> => {
    const [heartbeats, backlog] = await Promise.all([
      readHeartbeats().catch((e) => {
        // Redis unreachable: the redis check reports it, and without its
        // beat the worker cannot be judged alive (it needs Redis anyway).
        logCheckError("workers.heartbeat", e);
        return {} as Record<string, string>;
      }),
      readBacklog(new Date(now)).catch((e) => {
        logCheckError("workers.backlog", e);
        return null;
      }),
    ]);
    return workersVerdict(heartbeats, backlog, now);
  };
  const res = await Promise.race<WorkersCheck | "__timeout__">([
    evaluate(),
    new Promise<"__timeout__">((resolve) =>
      setTimeout(() => resolve("__timeout__"), CHECK_TIMEOUT_MS),
    ),
  ]);
  const value: WorkersCheck = res === "__timeout__" ? { status: "timeout" } : res;
  workersCache = { at: now, value };
  return value;
}

/** Test seam: forget the cached workers check. */
export function __resetWorkerHealthCacheForTests(): void {
  workersCache = null;
}
