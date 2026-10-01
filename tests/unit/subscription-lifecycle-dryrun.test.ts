/**
 * Review of 79422ba: the subscription scheduler and the API quota guard went
 * live on every existing row with nothing to show what the first tick would
 * do. `scripts/subscription-lifecycle-dryrun.ts` shows it (DRY RUN by
 * default) and fails unless NeuroFax is the one safe state, an open-ended
 * ACTIVE on a plan that is not Basic; its planning is pinned here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  dailyCoreProblems,
  forecastClinic,
  planPinOpenEnded,
  quotaOutcomes,
  type ClinicRow,
  type PlanRow,
  type SubscriptionRowWithPlan,
} from "../../scripts/_subscription-lifecycle-plan";
import {
  guardCounts,
  planContextOf,
  quotaCountQuery,
} from "@/server/billing/quota-rule";
import { GRACE_DAYS } from "@/server/platform/subscription-lifecycle";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T07:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const PRO: PlanRow = {
  id: "plan_pro",
  slug: "pro",
  isActive: true,
  features: { maxPatients: -1, maxAppointmentsPerMonth: -1 },
};
const BASIC: PlanRow = {
  id: "plan_basic",
  slug: "basic",
  isActive: true,
  features: { maxPatients: 50, maxAppointmentsPerMonth: 100 },
};

function sub(partial: Partial<SubscriptionRowWithPlan> = {}): SubscriptionRowWithPlan {
  return {
    id: "sub_1",
    status: "ACTIVE",
    planId: PRO.id,
    plan: PRO,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    graceEndsAt: null,
    cancelledAt: null,
    ...partial,
  };
}

function clinic(subscription: SubscriptionRowWithPlan | null, active = true): ClinicRow {
  return { id: "c_nf", slug: "neurofax", nameRu: "NeuroFax", active, subscription };
}

const COUNTS = { maxPatients: 4_210, maxAppointmentsPerMonth: 640 };

describe("the forecast: what the first tick and the later ones do", () => {
  it("the open-ended ACTIVE on Pro: nothing moves, nothing is counted", () => {
    const f = forecastClinic(clinic(sub()), NOW);
    expect(f.firstTick).toBeNull();
    expect(f.steps).toEqual([]);
    expect(f.finalStatus).toBe("ACTIVE");
    expect(quotaOutcomes(f.nowContext, COUNTS).every((o) => !o.counted)).toBe(true);
  });

  it("a PAST_DUE left by the old scheduler: grace on the first tick, CANCELLED and blocked 14 days on", () => {
    // The May backfill made every clinic a 30-day Pro TRIAL; the old
    // scheduler turned it PAST_DUE and stopped. This is that row.
    const f = forecastClinic(
      clinic(sub({ status: "PAST_DUE", trialEndsAt: new Date("2026-05-31T00:00:00Z") })),
      NOW,
    );
    expect(f.firstTick).toMatchObject({ reason: "grace_started", to: "PAST_DUE" });
    expect(f.steps.map((s) => s.step.to)).toEqual(["PAST_DUE", "CANCELLED"]);
    expect(f.steps[1]!.at.getTime()).toBe(days(GRACE_DAYS).getTime() + 1);
    expect(f.finalStatus).toBe("CANCELLED");
    // Today the plan's features, nothing counted; cancelled, Basic limits block the desk.
    expect(quotaOutcomes(f.nowContext, COUNTS).some((o) => o.counted)).toBe(false);
    expect(quotaOutcomes(f.finalContext, COUNTS)).toEqual([
      { quota: "maxPatients", counted: true, current: 4_210, max: 50, blocks: true },
      { quota: "maxAppointmentsPerMonth", counted: true, current: 640, max: 100, blocks: true },
    ]);
  });

  it("an expired TRIAL moves on the first tick", () => {
    const f = forecastClinic(clinic(sub({ status: "TRIAL", trialEndsAt: days(-1) })), NOW);
    expect(f.firstTick).toMatchObject({ reason: "trial_expired", to: "PAST_DUE" });
  });

  it("a clinic without a subscription is blocked today already", () => {
    const f = forecastClinic(clinic(null), NOW);
    expect(f.finalStatus).toBeNull();
    expect(quotaOutcomes(f.nowContext, COUNTS).every((o) => o.counted && o.blocks)).toBe(true);
  });

  it("the guard's own rule decides: Basic counts, a paying plan never does", () => {
    expect(guardCounts(planContextOf({ status: "ACTIVE", plan: BASIC }), "maxPatients")).toBe(true);
    expect(guardCounts(planContextOf({ status: "ACTIVE", plan: PRO }), "maxPatients")).toBe(false);
    expect(guardCounts(planContextOf({ status: "CANCELLED", plan: PRO }), "maxPatients")).toBe(true);
    expect(quotaCountQuery("c1", "maxPatients", NOW)).toEqual({
      model: "patient",
      where: { clinicId: "c1", deletedAt: null },
    });
    expect(quotaCountQuery("c1", "maxAppointmentsPerMonth", NOW).where).toMatchObject({
      createdAt: { gte: new Date("2026-10-01T00:00:00Z"), lt: new Date("2026-11-01T00:00:00Z") },
    });
  });
});

describe("the daily core check: NeuroFax must be an open-ended ACTIVE, not on Basic", () => {
  it("is safe exactly in that state", () => {
    expect(dailyCoreProblems(clinic(sub()))).toEqual([]);
  });

  it("names every reason it is not", () => {
    expect(dailyCoreProblems(clinic(null))).toEqual([
      expect.stringContaining("no subscription"),
    ]);
    expect(dailyCoreProblems(clinic(sub({ status: "PAST_DUE" })))).toEqual([
      expect.stringContaining("not ACTIVE"),
    ]);
    expect(dailyCoreProblems(clinic(sub({ currentPeriodEndsAt: days(20) })))).toEqual([
      expect.stringContaining("currentPeriodEndsAt"),
    ]);
    expect(dailyCoreProblems(clinic(sub({ planId: BASIC.id, plan: BASIC })))).toEqual([
      expect.stringContaining("basic"),
    ]);
    expect(dailyCoreProblems(clinic(sub(), false))).toEqual([
      expect.stringContaining("Clinic.active"),
    ]);
  });
});

describe("APPLY: pinning a clinic to an open-ended ACTIVE", () => {
  it("writes nothing when it is already pinned", () => {
    expect(planPinOpenEnded(clinic(sub()), PRO)).toEqual({ ok: true, action: "none" });
  });

  it("clears the dates that would end it, on the plan it is on or the one named", () => {
    const pastDue = clinic(
      sub({ status: "PAST_DUE", graceEndsAt: days(3), currentPeriodEndsAt: days(-10) }),
    );
    expect(planPinOpenEnded(pastDue, PRO)).toEqual({
      ok: true,
      action: "update",
      data: { status: "ACTIVE", currentPeriodEndsAt: null, graceEndsAt: null, cancelledAt: null },
    });
    const enterprise: PlanRow = { ...PRO, id: "plan_ent", slug: "enterprise" };
    expect(planPinOpenEnded(clinic(sub()), enterprise)).toMatchObject({
      ok: true,
      action: "update",
      data: { planId: "plan_ent" },
    });
  });

  it("creates the row for a clinic with none, but only on a named plan", () => {
    expect(planPinOpenEnded(clinic(null), PRO)).toEqual({
      ok: true,
      action: "create",
      planId: "plan_pro",
    });
    expect(planPinOpenEnded(clinic(null), null)).toMatchObject({ ok: false });
  });

  it("refuses Basic and a switched-off plan", () => {
    expect(planPinOpenEnded(clinic(sub({ planId: BASIC.id, plan: BASIC })), BASIC)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("plan_basic"),
    });
    expect(
      planPinOpenEnded(clinic(sub({ status: "PAST_DUE" })), { ...PRO, id: "p_old", isActive: false }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("plan_inactive") });
  });
});

describe("the script ships and is safe by default", () => {
  const src = read("scripts/subscription-lifecycle-dryrun.ts");
  const listed = read("scripts/worker-allowlist.txt")
    .split("\n")
    .map((l) => l.trim());

  it("is in the worker image with its planning helper", () => {
    expect(listed).toContain("subscription-lifecycle-dryrun.ts");
    expect(listed).toContain("_subscription-lifecycle-plan.ts");
  });

  it("writes only with APPLY=1 and an explicit CLINIC, and fails the check with exit code 2", () => {
    expect(src).toContain('const APPLY = process.env.APPLY === "1"');
    expect(src).toMatch(/if \(APPLY\) await apply\(now\)/);
    expect(src).toContain("APPLY=1 needs CLINIC=<slug>");
    expect(src).toContain("process.exitCode = 2");
    // Every write sits in apply(); the report only reads.
    const reportBody = src.slice(src.indexOf("async function report("), src.indexOf("async function apply("));
    expect(reportBody).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
  });

  it("uses the guard's and the scheduler's own rules, not copies", () => {
    const plan = read("scripts/_subscription-lifecycle-plan.ts");
    expect(plan).toContain("lifecycleProjection(sub, now)");
    expect(plan).toContain("planContextOf(");
    expect(plan).toContain("guardCounts(ctx, quota)");
    expect(src).toContain("quotaCountQuery(clinicId, quota, now)");
    expect(read("src/server/billing/plan-limits.ts")).toContain("planContextOf(sub)");
    expect(read("src/server/billing/plan-limits.ts")).toContain("guardCounts(planCtx, quota)");
  });
});
