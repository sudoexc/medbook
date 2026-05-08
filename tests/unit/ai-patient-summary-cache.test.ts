/**
 * Phase 15 Wave 2 — `src/server/ai/patient-summary-cache.ts` unit tests.
 *
 * The cache wrapper is the entry point for the patient-card / drawer.
 * Tests cover the freshness gate, visit invalidation, force-refresh, and
 * pendingRefresh wiring with a stub Prisma + a stub enqueue.
 */

import { describe, it, expect, vi } from "vitest";

import {
  classifyCacheAge,
  readOrRefreshPatientSummary,
  SUMMARY_TTL_HOURS,
} from "@/server/ai/patient-summary-cache";

type StubPrisma = {
  patient: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  appointment: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
};

function buildPrisma(opts: {
  patient: {
    summaryCache: string | null;
    summaryCacheUpdatedAt: Date | null;
  } | null;
  newestVisitAt: Date | null;
}): StubPrisma {
  return {
    patient: {
      findUnique: vi.fn().mockResolvedValue(
        opts.patient
          ? {
              id: "p1",
              summaryCache: opts.patient.summaryCache,
              summaryCacheUpdatedAt: opts.patient.summaryCacheUpdatedAt,
            }
          : null,
      ),
    },
    appointment: {
      findFirst: vi.fn().mockResolvedValue(
        opts.newestVisitAt ? { createdAt: opts.newestVisitAt } : null,
      ),
    },
  };
}

const NOW = new Date("2026-05-06T12:00:00Z");

describe("classifyCacheAge", () => {
  it("returns 'missing' when there is no cache timestamp", () => {
    expect(classifyCacheAge(null, null, NOW)).toBe("missing");
  });

  it("returns 'fresh' when within TTL and no newer visit", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(classifyCacheAge(oneHourAgo, null, NOW)).toBe("fresh");
  });

  it("returns 'stale' when older than TTL", () => {
    const past = new Date(
      NOW.getTime() - (SUMMARY_TTL_HOURS + 1) * 60 * 60 * 1000,
    );
    expect(classifyCacheAge(past, null, NOW)).toBe("stale");
  });

  it("returns 'stale' when a visit happened after the cache was built", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const thirtyMinAgo = new Date(NOW.getTime() - 30 * 60 * 1000);
    expect(classifyCacheAge(oneHourAgo, thirtyMinAgo, NOW)).toBe("stale");
  });

  it("returns 'fresh' when the visit predates the cache", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    expect(classifyCacheAge(oneHourAgo, twoHoursAgo, NOW)).toBe("fresh");
  });
});

describe("readOrRefreshPatientSummary — fresh cache path", () => {
  it("does not enqueue when cache is fresh", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = buildPrisma({
      patient: {
        summaryCache: "Hello world",
        summaryCacheUpdatedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      newestVisitAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      "user-1",
      "p1",
      "ru",
      { now: NOW, enqueueRefresh: enqueue },
    );

    expect(result.cacheAge).toBe("fresh");
    expect(result.pendingRefresh).toBe(false);
    expect(result.text).toBe("Hello world");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("readOrRefreshPatientSummary — stale cache enqueues refresh", () => {
  it("returns the stale text immediately and enqueues a refresh", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const stalePast = new Date(
      NOW.getTime() - (SUMMARY_TTL_HOURS + 1) * 60 * 60 * 1000,
    );
    const prisma = buildPrisma({
      patient: {
        summaryCache: "Old summary",
        summaryCacheUpdatedAt: stalePast,
      },
      newestVisitAt: null,
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      "user-1",
      "p1",
      "ru",
      { now: NOW, enqueueRefresh: enqueue },
    );

    expect(result.cacheAge).toBe("stale");
    expect(result.pendingRefresh).toBe(true);
    expect(result.text).toBe("Old summary");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      userId: "user-1",
      patientId: "p1",
      locale: "ru",
    });
  });
});

describe("readOrRefreshPatientSummary — missing cache enqueues refresh", () => {
  it("returns empty text + pendingRefresh: true when cache is missing", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = buildPrisma({
      patient: { summaryCache: null, summaryCacheUpdatedAt: null },
      newestVisitAt: null,
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      null,
      "p1",
      "uz",
      { now: NOW, enqueueRefresh: enqueue },
    );

    expect(result.cacheAge).toBe("missing");
    expect(result.pendingRefresh).toBe(true);
    expect(result.text).toBe("");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ locale: "uz" });
  });
});

describe("readOrRefreshPatientSummary — newer visit invalidates fresh cache", () => {
  it("treats a visit newer than the cache timestamp as stale", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const thirtyMinAgo = new Date(NOW.getTime() - 30 * 60 * 1000);
    const prisma = buildPrisma({
      patient: {
        summaryCache: "Stale due to new visit",
        summaryCacheUpdatedAt: oneHourAgo,
      },
      newestVisitAt: thirtyMinAgo,
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      "user-1",
      "p1",
      "ru",
      { now: NOW, enqueueRefresh: enqueue },
    );

    expect(result.cacheAge).toBe("stale");
    expect(result.pendingRefresh).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("readOrRefreshPatientSummary — forceRefresh always enqueues", () => {
  it("enqueues a refresh job even when the cache is fresh", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = buildPrisma({
      patient: {
        summaryCache: "Fresh enough",
        summaryCacheUpdatedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      newestVisitAt: null,
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      "user-1",
      "p1",
      "ru",
      { now: NOW, enqueueRefresh: enqueue, forceRefresh: true },
    );

    expect(result.cacheAge).toBe("fresh");
    expect(result.pendingRefresh).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("readOrRefreshPatientSummary — patient missing", () => {
  it("returns empty/missing without throwing when patient row is null", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = buildPrisma({
      patient: null,
      newestVisitAt: null,
    });

    const result = await readOrRefreshPatientSummary(
      prisma as never,
      "clinic-1",
      null,
      "p-missing",
      "ru",
      { now: NOW, enqueueRefresh: enqueue },
    );

    expect(result.text).toBe("");
    expect(result.cacheAge).toBe("missing");
    expect(result.pendingRefresh).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
