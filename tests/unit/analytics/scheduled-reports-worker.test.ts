/**
 * Phase 18 Wave 4 — `processSchedule` failure / disable path.
 *
 * We mock `@/lib/prisma` and `@/lib/tenant-context` so the worker can be
 * exercised without a real DB. The interesting invariant is the 3-strike
 * rule: third consecutive failure flips `enabled=false` and emits the
 * `SCHEDULED_REPORT_DISABLED_AFTER_FAILURES` audit row.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ScheduleRow {
  id: string;
  clinicId: string;
  savedReportId: string;
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
  nextRunAt: Date;
  deliveryChannel: "EMAIL" | "TELEGRAM";
  deliveryTarget: string;
  format: string;
  consecutiveFailures: number;
  enabled: boolean;
}

interface State {
  schedule: ScheduleRow;
  scheduleUpdates: Array<Record<string, unknown>>;
  audits: Array<{ action: string; meta: unknown }>;
  savedReport: {
    id: string;
    name: string;
    description: null;
    config: unknown;
    clinic: { nameRu: string; nameUz: string };
  } | null;
}

const state: State = {
  schedule: {
    id: "sched-1",
    clinicId: "clinic-1",
    savedReportId: "saved-1",
    cadence: "DAILY",
    nextRunAt: new Date("2026-05-07T05:00:00Z"),
    deliveryChannel: "EMAIL",
    deliveryTarget: "ops@example.com",
    format: "pdf",
    consecutiveFailures: 0,
    enabled: true,
  },
  scheduleUpdates: [],
  audits: [],
  savedReport: null,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledReport: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.schedule, data);
        state.scheduleUpdates.push(data);
        return state.schedule;
      }),
    },
    savedReport: {
      findFirst: vi.fn(async () => state.savedReport),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; meta: unknown };
        }) => {
          state.audits.push({ action: data.action, meta: data.meta });
          return data;
        },
      ),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (
    _ctx: unknown,
    fn: () => Promise<unknown>,
  ): Promise<unknown> => fn(),
}));

// Replace the report runner so we don't hit Prisma's aggregator.
vi.mock("@/server/analytics/report-runner", () => ({
  runReport: vi.fn(async () => ({
    rows: [{ doctor: "Каримов", revenue: BigInt(1234) }],
    columns: [
      { key: "doctor", label: "Врач", kind: "dimension", unit: "text" },
      { key: "revenue", label: "Выручка", kind: "measure", unit: "tiins" },
    ],
    rowCount: 1,
    truncated: false,
    runMs: 5,
    generatedAt: new Date().toISOString(),
  })),
}));

// Stub the heavy PDF formatter so the test focuses on the failure path.
vi.mock("@/server/analytics/pdf", () => ({
  formatReportPdf: vi.fn(async () => Buffer.from("%PDF-1.4 stub")),
  pdfFilename: vi.fn(() => "stub.pdf"),
  PDF_ROW_CAP: 5000,
}));

// Always report a sane parse.
vi.mock("@/server/analytics/report-config", () => ({
  parseReportConfig: vi.fn(() => ({
    dimensions: ["doctor"],
    measures: ["revenue_tiins"],
    filters: { dateFrom: "2026-04-01", dateTo: "2026-04-30" },
  })),
}));

import { processSchedule } from "@/server/workers/scheduled-reports";
import { AUDIT_ACTION } from "@/lib/audit-actions";

beforeEach(() => {
  state.schedule = {
    id: "sched-1",
    clinicId: "clinic-1",
    savedReportId: "saved-1",
    cadence: "DAILY",
    nextRunAt: new Date("2026-05-07T05:00:00Z"),
    deliveryChannel: "EMAIL",
    deliveryTarget: "ops@example.com",
    format: "pdf",
    consecutiveFailures: 0,
    enabled: true,
  };
  state.scheduleUpdates = [];
  state.audits = [];
  state.savedReport = {
    id: "saved-1",
    name: "Выручка по врачам",
    description: null,
    config: {},
    clinic: { nameRu: "Тест", nameUz: "Test" },
  };
});

describe("processSchedule — failure handling", () => {
  it("first failure: increments consecutiveFailures, audits FAILED, advances nextRunAt, stays enabled", async () => {
    const result = await processSchedule(
      { ...state.schedule },
      {
        deliver: vi.fn(async () => ({ ok: false, error: "smtp_unreachable" })),
        now: () => new Date("2026-05-07T05:00:00Z"),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.disabled).toBeUndefined();
    expect(state.schedule.consecutiveFailures).toBe(1);
    expect(state.schedule.enabled).toBe(true);
    expect(
      state.audits.some((a) => a.action === AUDIT_ACTION.SCHEDULED_REPORT_FAILED),
    ).toBe(true);
    expect(
      state.audits.some(
        (a) => a.action === AUDIT_ACTION.SCHEDULED_REPORT_DISABLED_AFTER_FAILURES,
      ),
    ).toBe(false);
    // nextRunAt was advanced (any change is fine — cadence helper has its own tests).
    const upd = state.scheduleUpdates[0];
    expect(upd.nextRunAt).toBeInstanceOf(Date);
  });

  it("third failure: flips enabled=false and emits DISABLED_AFTER_FAILURES audit", async () => {
    const result = await processSchedule(
      { ...state.schedule, consecutiveFailures: 2 },
      {
        deliver: vi.fn(async () => ({ ok: false, error: "telegram_chat_not_found" })),
        now: () => new Date("2026-05-07T05:00:00Z"),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.disabled).toBe(true);
    expect(state.schedule.consecutiveFailures).toBe(3);
    expect(state.schedule.enabled).toBe(false);
    expect(
      state.audits.some(
        (a) => a.action === AUDIT_ACTION.SCHEDULED_REPORT_DISABLED_AFTER_FAILURES,
      ),
    ).toBe(true);
  });

  it("success path: resets failures, audits DELIVERED, advances nextRunAt", async () => {
    const result = await processSchedule(
      { ...state.schedule, consecutiveFailures: 2 },
      {
        deliver: vi.fn(async () => ({ ok: true })),
        now: () => new Date("2026-05-07T05:00:00Z"),
      },
    );
    expect(result.ok).toBe(true);
    expect(state.schedule.consecutiveFailures).toBe(0);
    expect(
      state.audits.some(
        (a) => a.action === AUDIT_ACTION.SCHEDULED_REPORT_DELIVERED,
      ),
    ).toBe(true);
  });

  it("missing SavedReport throws inside processSchedule and is treated as a failure", async () => {
    state.savedReport = null;
    const result = await processSchedule(
      { ...state.schedule },
      {
        deliver: vi.fn(async () => ({ ok: true })),
        now: () => new Date("2026-05-07T05:00:00Z"),
      },
    );
    expect(result.ok).toBe(false);
    expect(state.schedule.consecutiveFailures).toBe(1);
  });
});
