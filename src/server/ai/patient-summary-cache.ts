/**
 * Phase 15 Wave 2 — Patient summary cache + async refresh wrapper.
 *
 * The patient card / appointment drawer call `readOrRefreshPatientSummary`
 * to render the AI summary. The function:
 *
 *   1. Reads the patient row to get `summaryCache` + `summaryCacheUpdatedAt`.
 *   2. Decides freshness vs. staleness vs. missing — newer visit
 *      (`Appointment.createdAt > summaryCacheUpdatedAt`) invalidates
 *      regardless of TTL.
 *   3. Returns immediately with whatever text we have (or empty placeholder)
 *      and a `pendingRefresh: true` when a refresh job is enqueued.
 *
 * The async path lives in `patient-summary-worker.ts`: the worker fetches
 * full DB context, calls `generatePatientSummary`, writes the result, and
 * publishes a `patient.summary.refreshed` SSE event so the UI can re-fetch
 * without polling.
 */

import { enqueue } from "@/server/queue";
import { JOB_NAME, QUEUE_NAME } from "@/server/workers/patient-summary-refresh";

/**
 * Minimal Prisma surface this module needs. Typed structurally so tests can
 * pass a tiny stub without instantiating PrismaClient. Production callers
 * pass the singleton from `@/lib/prisma`.
 */
type PrismaLike = {
  patient: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; summaryCache: true; summaryCacheUpdatedAt: true };
    }) => Promise<{
      id: string;
      summaryCache: string | null;
      summaryCacheUpdatedAt: Date | null;
    } | null>;
  };
  appointment: {
    findFirst: (args: {
      where: { patientId: string };
      select: { createdAt: true };
      orderBy: { createdAt: "desc" };
    }) => Promise<{ createdAt: Date } | null>;
  };
};

export const SUMMARY_TTL_HOURS = 24;
const TTL_MS = SUMMARY_TTL_HOURS * 60 * 60 * 1000;

export type SummaryCacheAge = "fresh" | "stale" | "missing";

export type ReadOrRefreshResult = {
  text: string;
  cacheAge: SummaryCacheAge;
  pendingRefresh: boolean;
  /** ISO timestamp the cached text was written at, or null when missing. */
  updatedAt: string | null;
};

export type ReadOrRefreshOptions = {
  forceRefresh?: boolean;
  /** Test seam — override the wallclock so freshness logic is deterministic. */
  now?: Date;
  /**
   * Test seam — override the enqueue function. In production we hand off
   * to `src/server/queue` which routes to the in-memory worker.
   */
  enqueueRefresh?: (payload: PatientSummaryRefreshPayload) => Promise<void>;
};

export type PatientSummaryRefreshPayload = {
  clinicId: string;
  userId: string | null;
  patientId: string;
  locale: "ru" | "uz";
};

/**
 * Decide freshness from cache timestamp + most recent visit.
 *
 * Rules:
 *   - cache absent  → "missing"
 *   - cache > TTL   → "stale"
 *   - newer visit   → "stale" (visit happened after the cache was built)
 *   - otherwise     → "fresh"
 */
export function classifyCacheAge(
  cacheUpdatedAt: Date | null,
  newestVisitAt: Date | null,
  now: Date,
): SummaryCacheAge {
  if (!cacheUpdatedAt) return "missing";
  if (now.getTime() - cacheUpdatedAt.getTime() > TTL_MS) return "stale";
  if (newestVisitAt && newestVisitAt.getTime() > cacheUpdatedAt.getTime()) {
    return "stale";
  }
  return "fresh";
}

async function defaultEnqueue(
  payload: PatientSummaryRefreshPayload,
): Promise<void> {
  await enqueue(QUEUE_NAME, JOB_NAME, payload);
}

/**
 * Read the cached summary; if stale / missing / forced, enqueue an async
 * refresh and return the current text immediately. The UI subscribes to
 * `patient.summary.refreshed` and refetches when the worker publishes.
 */
export async function readOrRefreshPatientSummary(
  prisma: PrismaLike,
  clinicId: string,
  userId: string | null,
  patientId: string,
  locale: "ru" | "uz",
  options?: ReadOrRefreshOptions,
): Promise<ReadOrRefreshResult> {
  const now = options?.now ?? new Date();
  const enqueueRefresh = options?.enqueueRefresh ?? defaultEnqueue;
  const forceRefresh = options?.forceRefresh === true;

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      summaryCache: true,
      summaryCacheUpdatedAt: true,
    },
  });

  if (!patient) {
    return {
      text: "",
      cacheAge: "missing",
      pendingRefresh: false,
      updatedAt: null,
    };
  }

  // Cheapest signal of "did anything happen since the cache was built": the
  // most recent appointment.createdAt for this patient. Schema has an index
  // `(clinicId, patientId)` so this is O(log n).
  const newestVisit = await prisma.appointment.findFirst({
    where: { patientId },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const cacheAge = classifyCacheAge(
    patient.summaryCacheUpdatedAt ?? null,
    newestVisit?.createdAt ?? null,
    now,
  );

  const shouldRefresh = forceRefresh || cacheAge !== "fresh";
  const pendingRefresh = shouldRefresh;

  if (shouldRefresh) {
    // Fire-and-forget; never block the caller. The worker writes
    // summaryCache + publishes the realtime event when done.
    void enqueueRefresh({ clinicId, userId, patientId, locale });
  }

  return {
    text: patient.summaryCache ?? "",
    cacheAge,
    pendingRefresh,
    updatedAt: patient.summaryCacheUpdatedAt
      ? patient.summaryCacheUpdatedAt.toISOString()
      : null,
  };
}
