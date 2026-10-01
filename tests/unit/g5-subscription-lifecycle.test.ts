/**
 * Audit G5-01 (one trial-extension rule, PAST_DUE back to TRIAL, restore
 * only a cancelled subscription and to what it was), G5-02 (the lifecycle
 * closes: PAST_DUE ends, ACTIVE ends with its paid period, every automatic
 * step audited, the payment banner only for ADMIN) and G5-03 (a clinic gets
 * its subscription when it is created; looking writes nothing).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRACE_DAYS,
  nextAutoStep,
  planCancel,
  planExtendTrial,
  planRestore,
  snapshotFromMeta,
  snapshotOf,
  statusOverrideExtras,
  type SubscriptionState,
} from "@/server/platform/subscription-lifecycle";
import { canSeePaymentBanner } from "@/components/layout/trial-banner-state";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T07:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function sub(partial: Partial<SubscriptionState>): SubscriptionState {
  return {
    status: "TRIAL",
    planId: "plan_pro",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    graceEndsAt: null,
    cancelledAt: null,
    ...partial,
  };
}

// ── G5-01: the planners ──────────────────────────────────────────────────

describe("G5-01: extending a trial", () => {
  it("PAST_DUE comes back to TRIAL until now + 30 days, the grace cleared", () => {
    const plan = planExtendTrial(
      sub({ status: "PAST_DUE", trialEndsAt: days(-3), graceEndsAt: days(11) }),
      NOW,
    );
    expect(plan).toEqual({
      ok: true,
      data: { status: "TRIAL", trialEndsAt: days(30), graceEndsAt: null, cancelledAt: null },
    });
  });

  it("a running trial gets 30 days more from its end; a cancelled one is a trial again", () => {
    expect(planExtendTrial(sub({ trialEndsAt: days(5) }), NOW)).toMatchObject({
      ok: true,
      data: { trialEndsAt: days(35) },
    });
    expect(
      planExtendTrial(sub({ status: "CANCELLED", cancelledAt: days(-1) }), NOW),
    ).toMatchObject({ ok: true, data: { status: "TRIAL", cancelledAt: null } });
  });

  it("a paying (ACTIVE) clinic is refused, not demoted to a trial", () => {
    expect(planExtendTrial(sub({ status: "ACTIVE" }), NOW)).toEqual({
      ok: false,
      reason: "subscription_active",
    });
  });

  it("a second click with the date it saw is refused instead of adding a month", () => {
    const s = sub({ trialEndsAt: days(35) });
    expect(planExtendTrial(s, NOW, { expectedTrialEndsAt: days(5) })).toEqual({
      ok: false,
      reason: "subscription_changed",
    });
    expect(planExtendTrial(s, NOW, { expectedTrialEndsAt: days(35) }).ok).toBe(true);
  });
});

describe("G5-01: cancel and restore", () => {
  it("restore is only for a cancelled subscription", () => {
    expect(planRestore(sub({ status: "ACTIVE" }), null, NOW)).toEqual({
      ok: false,
      reason: "not_cancelled",
    });
    expect(planCancel(sub({ status: "CANCELLED" }), NOW)).toEqual({
      ok: false,
      reason: "already_cancelled",
    });
  });

  it("an open-ended ACTIVE comes back ACTIVE, not as a 14-day trial", () => {
    const before = sub({ status: "ACTIVE" });
    const snap = snapshotOf(before);
    const cancelled = { ...before, status: "CANCELLED" as const, cancelledAt: NOW };
    expect(planRestore(cancelled, snap, NOW)).toEqual({
      ok: true,
      data: { planId: "plan_pro", status: "ACTIVE", graceEndsAt: null, cancelledAt: null },
    });
  });

  it("a trial still running comes back with its date; one that ran out is PAST_DUE with grace", () => {
    const cancelled = (trialEndsAt: Date) =>
      sub({ status: "CANCELLED", trialEndsAt, cancelledAt: NOW });
    expect(
      planRestore(cancelled(days(9)), snapshotOf(sub({ trialEndsAt: days(9) })), NOW),
    ).toMatchObject({ ok: true, data: { status: "TRIAL", trialEndsAt: days(9) } });
    expect(
      planRestore(cancelled(days(-2)), snapshotOf(sub({ trialEndsAt: days(-2) })), NOW),
    ).toMatchObject({ ok: true, data: { status: "PAST_DUE", graceEndsAt: days(GRACE_DAYS) } });
  });

  it("older suspensions recorded only the status; the row's dates stand in", () => {
    const snap = snapshotFromMeta({ previousStatus: "ACTIVE" });
    expect(snap?.status).toBe("ACTIVE");
    const cancelled = sub({ status: "CANCELLED", currentPeriodEndsAt: days(-1), cancelledAt: NOW });
    expect(planRestore(cancelled, snap, NOW)).toMatchObject({
      ok: true,
      data: { status: "PAST_DUE" },
    });
  });
});

// ── G5-02: the clock ─────────────────────────────────────────────────────

describe("G5-02: every state ends", () => {
  it("an expired trial becomes PAST_DUE with a grace period", () => {
    expect(nextAutoStep(sub({ trialEndsAt: days(-1) }), NOW)).toEqual({
      reason: "trial_expired",
      to: "PAST_DUE",
      data: { status: "PAST_DUE", graceEndsAt: days(GRACE_DAYS) },
    });
  });

  it("an ACTIVE whose paid period ended becomes PAST_DUE", () => {
    expect(
      nextAutoStep(sub({ status: "ACTIVE", currentPeriodEndsAt: days(-1) }), NOW)?.to,
    ).toBe("PAST_DUE");
  });

  it("an open-ended ACTIVE (NeuroFax) is never touched", () => {
    expect(nextAutoStep(sub({ status: "ACTIVE" }), NOW)).toBeNull();
  });

  it("PAST_DUE with an expired grace period becomes CANCELLED", () => {
    expect(
      nextAutoStep(sub({ status: "PAST_DUE", graceEndsAt: days(-1) }), NOW),
    ).toEqual({
      reason: "grace_ended",
      to: "CANCELLED",
      data: { status: "CANCELLED", cancelledAt: NOW },
    });
  });

  it("a PAST_DUE with no grace date gets one now instead of an instant cancel", () => {
    expect(nextAutoStep(sub({ status: "PAST_DUE" }), NOW)).toEqual({
      reason: "grace_started",
      to: "PAST_DUE",
      data: { graceEndsAt: days(GRACE_DAYS) },
    });
  });

  it("the admin's raw status override keeps the dates consistent", () => {
    expect(statusOverrideExtras(sub({ status: "ACTIVE" }), "PAST_DUE", NOW)).toEqual({
      graceEndsAt: days(GRACE_DAYS),
    });
    expect(
      statusOverrideExtras(sub({ status: "CANCELLED", cancelledAt: NOW }), "ACTIVE", NOW),
    ).toEqual({ graceEndsAt: null, cancelledAt: null });
  });

  it("only the clinic's ADMIN (or an impersonating SUPER_ADMIN) sees the payment banner", () => {
    expect(canSeePaymentBanner("ADMIN")).toBe(true);
    expect(canSeePaymentBanner("SUPER_ADMIN")).toBe(true);
    for (const r of ["RECEPTIONIST", "NURSE", "DOCTOR", "CALL_OPERATOR", null]) {
      expect(canSeePaymentBanner(r)).toBe(false);
    }
  });
});

// ── DB-backed: scheduler + routes ────────────────────────────────────────

type SubRow = SubscriptionState & { id: string; clinicId: string; createdAt: Date; updatedAt: Date };

const db = vi.hoisted(() => ({
  subs: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; clinicId: string | null; meta: Record<string, unknown>; createdAt: Date; entityType?: string }>,
  plans: [
    { id: "plan_basic", slug: "basic", isActive: true },
    { id: "plan_pro", slug: "pro", isActive: true },
  ],
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "sa1", role: "SUPER_ADMIN" } })),
}));
vi.mock("@/server/auth/mfa-gate", () => ({
  owesTotpEnrolment: vi.fn(async () => false),
  mfaRequiredResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/server/queue", () => ({ getQueue: () => ({}) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Array<Record<string, unknown>>).some((w) => matches(row, w))) return false;
      continue;
    }
    const cell = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const op = v as { lt?: Date };
      if (op.lt) {
        if (!(cell instanceof Date) || !(cell < op.lt)) return false;
      }
      continue;
    }
    if (v instanceof Date) {
      if (!(cell instanceof Date) || cell.getTime() !== v.getTime()) return false;
      continue;
    }
    if (cell !== v && !(cell == null && v == null)) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    plan: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) =>
        db.plans.find((p) => p.id === where.id || p.slug === where.slug) ?? null,
      ),
    },
    subscription: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.subs.filter((s) => matches(s, where)).map((s) => ({ ...s })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { clinicId: string } }) => {
        const s = db.subs.find((x) => x.clinicId === where.clinicId);
        return s ? { ...s, plan: db.plans.find((p) => p.id === s.planId) } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { clinicId: string }; data: Record<string, unknown> }) => {
        const s = db.subs.find((x) => x.clinicId === where.clinicId)!;
        Object.assign(s, data, { updatedAt: new Date() });
        return { ...s, plan: db.plans.find((p) => p.id === s.planId) };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const s = db.subs.find((x) => matches(x, where));
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sub_${db.subs.length + 1}`, graceEndsAt: null, currentPeriodEndsAt: null, cancelledAt: null, createdAt: NOW, updatedAt: NOW, ...data };
        db.subs.push(row);
        return row;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; clinicId: string | null; meta: Record<string, unknown>; entityType?: string } }) => {
        db.audits.push({ ...data, createdAt: new Date() });
        return data;
      }),
      findMany: vi.fn(async ({ where }: { where: { clinicId: string; action: { in: string[] } } }) =>
        db.audits
          .filter((a) => a.clinicId === where.clinicId && where.action.in.includes(a.action))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    },
  },
}));

function seed(partial: Partial<SubRow> & { clinicId: string }) {
  db.subs.push({
    id: `sub_${partial.clinicId}`,
    status: "TRIAL",
    planId: "plan_pro",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    graceEndsAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  });
}

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  db.subs = [];
  db.audits = [];
});

describe("G5-02: the scheduler closes the lifecycle and audits each step", () => {
  it("TRIAL → PAST_DUE, ACTIVE → PAST_DUE, PAST_DUE → CANCELLED, each with an AuditLog row", async () => {
    const past = new Date(Date.now() - DAY);
    seed({ clinicId: "c_trial", status: "TRIAL", trialEndsAt: past });
    seed({ clinicId: "c_paid", status: "ACTIVE", currentPeriodEndsAt: past });
    seed({ clinicId: "c_grace", status: "PAST_DUE", graceEndsAt: past });
    seed({ clinicId: "c_neurofax", status: "ACTIVE" });
    const { _tickForTests } = await import("@/server/workers/trial-expiry-scheduler");
    await _tickForTests();
    const status = (c: string) => db.subs.find((s) => s.clinicId === c)!.status;
    expect(status("c_trial")).toBe("PAST_DUE");
    expect(status("c_paid")).toBe("PAST_DUE");
    expect(status("c_grace")).toBe("CANCELLED");
    expect(status("c_neurofax")).toBe("ACTIVE");
    expect(db.subs.find((s) => s.clinicId === "c_trial")!.graceEndsAt).toBeInstanceOf(Date);
    const auto = db.audits.filter((a) => a.action === "SUBSCRIPTION_AUTO_TRANSITION");
    expect(auto.map((a) => [a.clinicId, a.meta.to]).sort()).toEqual([
      ["c_grace", "CANCELLED"],
      ["c_paid", "PAST_DUE"],
      ["c_trial", "PAST_DUE"],
    ]);
    expect(auto.every((a) => a.meta.previous)).toBe(true);
  });
});

describe("G5-01: the routes share one rule and one audit action", () => {
  it("«Продлить триал» on PAST_DUE gives TRIAL now + 30 days and the real status back", async () => {
    seed({ clinicId: "c1", status: "PAST_DUE", trialEndsAt: days(-3), graceEndsAt: days(10) });
    const { POST } = await import("@/app/api/admin/clinics/[id]/subscription/extend-trial/route");
    const res = await POST(post("https://x/api/admin/clinics/c1/subscription/extend-trial"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { status: string; graceEndsAt: unknown } };
    expect(body.subscription.status).toBe("TRIAL");
    expect(body.subscription.graceEndsAt).toBeNull();
    expect(db.audits.map((a) => a.action)).toEqual(["CLINIC_TRIAL_EXTENDED"]);
  });

  it("the row menu's «Пробный +30 дней» does the same and audits the same action", async () => {
    seed({ clinicId: "c1", status: "PAST_DUE", trialEndsAt: days(-3), graceEndsAt: days(10) });
    const { POST } = await import("@/app/api/admin/clinics/[id]/lifecycle/route");
    const res = await POST(post("https://x/api/admin/clinics/c1/lifecycle", { action: "extend-trial" }));
    expect(res.status).toBe(200);
    expect(db.subs[0]!.status).toBe("TRIAL");
    expect(db.audits.map((a) => a.action)).toEqual(["CLINIC_TRIAL_EXTENDED"]);
  });

  it("a double click with the shown date is a 409, not a second month", async () => {
    const shown = days(5);
    seed({ clinicId: "c1", status: "TRIAL", trialEndsAt: shown });
    const { POST } = await import("@/app/api/admin/clinics/[id]/subscription/extend-trial/route");
    const url = "https://x/api/admin/clinics/c1/subscription/extend-trial";
    expect((await POST(post(url, { expectedTrialEndsAt: shown.toISOString() }))).status).toBe(200);
    const second = await POST(post(url, { expectedTrialEndsAt: shown.toISOString() }));
    expect(second.status).toBe(409);
    expect((db.subs[0]!.trialEndsAt as Date).getTime()).toBe(days(35).getTime());
  });

  it("«Восстановить» on an ACTIVE clinic is refused", async () => {
    seed({ clinicId: "c1", status: "ACTIVE" });
    const { POST } = await import("@/app/api/admin/clinics/[id]/lifecycle/route");
    const res = await POST(post("https://x/api/admin/clinics/c1/lifecycle", { action: "restore" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("not_cancelled");
    expect(db.subs[0]!.status).toBe("ACTIVE");
  });

  it("cancel then restore brings an open-ended ACTIVE back as it was", async () => {
    seed({ clinicId: "c1", status: "ACTIVE" });
    const { POST: cancel } = await import("@/app/api/admin/clinics/[id]/subscription/cancel/route");
    await cancel(post("https://x/api/admin/clinics/c1/subscription/cancel"));
    expect(db.subs[0]!.status).toBe("CANCELLED");
    expect(db.audits[0]).toMatchObject({
      action: "CLINIC_SUSPENDED",
      meta: { previousStatus: "ACTIVE", to: "CANCELLED" },
    });
    const { POST } = await import("@/app/api/admin/clinics/[id]/lifecycle/route");
    const res = await POST(post("https://x/api/admin/clinics/c1/lifecycle", { action: "restore" }));
    expect(res.status).toBe(200);
    expect(db.subs[0]!.status).toBe("ACTIVE");
    expect(db.subs[0]!.trialEndsAt).toBeNull();
  });
});

describe("G5-03: subscriptions are created explicitly", () => {
  it("a clinic without one: GET writes nothing, actions answer 409", async () => {
    const sub = await import("@/app/api/admin/clinics/[id]/subscription/route");
    const res = await sub.GET(new Request("https://x/api/admin/clinics/c9/subscription"));
    expect(((await res.json()) as { subscription: unknown }).subscription).toBeNull();
    const { POST } = await import("@/app/api/admin/clinics/[id]/subscription/extend-trial/route");
    expect((await POST(post("https://x/api/admin/clinics/c9/subscription/extend-trial"))).status).toBe(409);
    expect(db.subs).toHaveLength(0);
  });

  it("«Создать подписку» makes a TRIAL on the chosen plan for the chosen days", async () => {
    const sub = await import("@/app/api/admin/clinics/[id]/subscription/route");
    const res = await sub.POST(
      post("https://x/api/admin/clinics/c9/subscription", { planId: "plan_basic", trialDays: 14 }),
    );
    expect(res.status).toBe(201);
    expect(db.subs[0]).toMatchObject({ clinicId: "c9", planId: "plan_basic", status: "TRIAL" });
    const again = await sub.POST(
      post("https://x/api/admin/clinics/c9/subscription", { planId: "plan_basic", trialDays: 14 }),
    );
    expect(again.status).toBe(409);
  });

  it("no route and no page creates a subscription as a side effect any more", () => {
    for (const f of [
      "src/app/api/admin/clinics/[id]/subscription/route.ts",
      "src/app/api/admin/clinics/[id]/subscription/cancel/route.ts",
      "src/app/api/admin/clinics/[id]/subscription/extend-trial/route.ts",
      "src/app/api/admin/clinics/[id]/lifecycle/route.ts",
      "src/app/admin/clinics/[id]/billing/page.tsx",
    ]) {
      expect(read(f)).not.toContain("subscription.create(");
    }
    expect(read("src/app/api/platform/clinics/route.ts")).toContain("createSubscription(tx");
    expect(read("src/app/api/public/signup/confirm/route.ts")).toContain("createSubscription(tx");
  });
});
