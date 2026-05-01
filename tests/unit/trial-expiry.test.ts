/**
 * Phase 9e — pure helpers extracted from the trial-expiry scheduler.
 *
 * `selectExpiredTrials(rows, now)` and `nextStatusFor(sub, now)` deliberately
 * have no Prisma / no AsyncLocalStorage / no clock — they're total functions
 * over plain row shapes so the scheduler's transition logic is testable
 * without a database or fake timers.
 *
 * The matrix below covers every cell of the status × deadline grid the
 * scheduler can hit in production, plus the two boundary cases (null
 * deadline, deadline === now).
 */
import { describe, it, expect } from "vitest";

import {
  selectExpiredTrials,
  nextStatusFor,
  type SubscriptionRow,
} from "@/server/workers/trial-expiry-scheduler";

const NOW = new Date("2026-05-01T12:00:00.000Z");

function row(
  partial: Partial<SubscriptionRow> & {
    status: SubscriptionRow["status"];
    trialEndsAt: Date | null;
  },
): SubscriptionRow {
  return {
    id: partial.id ?? "sub_x",
    clinicId: partial.clinicId ?? "clinic_x",
    status: partial.status,
    trialEndsAt: partial.trialEndsAt,
  };
}

describe("selectExpiredTrials", () => {
  it("picks TRIAL whose trialEndsAt is strictly before now", () => {
    const rows = [
      row({
        id: "a",
        status: "TRIAL",
        trialEndsAt: new Date(NOW.getTime() - 60_000),
      }),
      row({
        id: "b",
        status: "TRIAL",
        trialEndsAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      }),
    ];
    const out = selectExpiredTrials(rows, NOW);
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("does NOT pick TRIAL whose trialEndsAt is in the future", () => {
    const rows = [
      row({
        id: "future",
        status: "TRIAL",
        trialEndsAt: new Date(NOW.getTime() + 60_000),
      }),
      row({
        id: "tomorrow",
        status: "TRIAL",
        trialEndsAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      }),
    ];
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("treats trialEndsAt === now as not yet expired (boundary)", () => {
    const rows = [
      row({
        id: "boundary",
        status: "TRIAL",
        trialEndsAt: new Date(NOW.getTime()),
      }),
    ];
    // Mirrors Prisma's `lt` (strict less-than) — equality is still trial.
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("skips TRIAL rows with null trialEndsAt", () => {
    const rows = [row({ id: "no-deadline", status: "TRIAL", trialEndsAt: null })];
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("skips already-PAST_DUE rows (no double-flip)", () => {
    const rows = [
      row({
        id: "already",
        status: "PAST_DUE",
        trialEndsAt: new Date(NOW.getTime() - 60_000),
      }),
    ];
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("skips ACTIVE rows even with an expired trialEndsAt", () => {
    // Operator may have manually moved a clinic to ACTIVE; trialEndsAt
    // could remain in the past as a historical artifact. Don't touch it.
    const rows = [
      row({
        id: "paid",
        status: "ACTIVE",
        trialEndsAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
      }),
    ];
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("skips CANCELLED rows", () => {
    const rows = [
      row({
        id: "gone",
        status: "CANCELLED",
        trialEndsAt: new Date(NOW.getTime() - 60_000),
      }),
    ];
    expect(selectExpiredTrials(rows, NOW)).toEqual([]);
  });

  it("preserves input order and does not mutate input", () => {
    const a = row({
      id: "a",
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    const b = row({
      id: "b",
      status: "ACTIVE",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    const c = row({
      id: "c",
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() - 120_000),
    });
    const input = [a, b, c];
    const out = selectExpiredTrials(input, NOW);
    expect(out).toEqual([a, c]);
    // Input untouched.
    expect(input).toEqual([a, b, c]);
  });
});

describe("nextStatusFor", () => {
  it("TRIAL & expired → PAST_DUE", () => {
    const r = row({
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    expect(nextStatusFor(r, NOW)).toBe("PAST_DUE");
  });

  it("TRIAL & not yet expired → TRIAL", () => {
    const r = row({
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() + 60_000),
    });
    expect(nextStatusFor(r, NOW)).toBe("TRIAL");
  });

  it("TRIAL & exactly on boundary → TRIAL (strict less-than)", () => {
    const r = row({ status: "TRIAL", trialEndsAt: new Date(NOW.getTime()) });
    expect(nextStatusFor(r, NOW)).toBe("TRIAL");
  });

  it("TRIAL & null trialEndsAt → TRIAL (open-ended)", () => {
    const r = row({ status: "TRIAL", trialEndsAt: null });
    expect(nextStatusFor(r, NOW)).toBe("TRIAL");
  });

  it("PAST_DUE → PAST_DUE (idempotent, no double-flip)", () => {
    const r = row({
      status: "PAST_DUE",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    expect(nextStatusFor(r, NOW)).toBe("PAST_DUE");
  });

  it("ACTIVE → ACTIVE (paid customers untouched)", () => {
    const r = row({
      status: "ACTIVE",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    expect(nextStatusFor(r, NOW)).toBe("ACTIVE");
  });

  it("CANCELLED → CANCELLED (no resurrection)", () => {
    const r = row({
      status: "CANCELLED",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    expect(nextStatusFor(r, NOW)).toBe("CANCELLED");
  });
});
