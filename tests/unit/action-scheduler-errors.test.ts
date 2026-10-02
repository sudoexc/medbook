/**
 * Audit AC-25: the recompute tick logged only «errors=1». A detector that
 * throws is isolated by the engine (the others still run), so its task type
 * silently stopped appearing and the worker log never said which one or why.
 * Acceptance: an induced detector error is in the worker log with its type
 * and message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { clinic: { findMany: vi.fn(async () => [{ id: "c1" }]) } },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/server/actions/engine", () => ({
  runActionEngine: vi.fn(async () => ({
    created: 2,
    updated: 0,
    skipped: 5,
    expired: 0,
    errors: [
      {
        type: "OVERDUE_FOLLOW_UP",
        error: 'Invalid `prisma.appointment.findMany()` invocation: column "x" does not exist',
      },
    ],
  })),
}));

import { _tickForTests } from "@/server/actions/scheduler";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("action-engine tick (audit AC-25)", () => {
  it("logs each detector failure with clinic, type and message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await _tickForTests();

    const lines = error.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      '[action-engine] clinic=c1 detector=OVERDUE_FOLLOW_UP failed: Invalid `prisma.appointment.findMany()` invocation: column "x" does not exist',
    ]);
    // The summary keeps its counter.
    expect(String(info.mock.calls.at(-1)?.[0])).toContain("errors=1");
  });
});
