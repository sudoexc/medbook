/**
 * Final review of P5: the subscription scheduler could cancel NeuroFax's own
 * subscription and lock reception out, and the check meant to prevent it
 * (scripts/subscription-lifecycle-dryrun.ts) was run by no deploy.
 *
 * The May backfill (20260501091536) made every clinic a 30-day TRIAL; the
 * old scheduler moved it to PAST_DUE with no grace date and stopped. The new
 * tick would start a 14-day grace on it and then set CANCELLED, which means
 * Basic limits: 402 on reception's patient create, booking and walk-in.
 *
 * Now:
 *   - the deploy (ops/deploy.sh, and _deploy.sh as DEPLOY.md gives it) runs
 *     the migration, then the dry run, and only then starts the new app and
 *     worker, stopping on a failed dry run;
 *   - should that be skipped, the scheduler never steps the platform
 *     owner's own clinic, and says so in the log once per worker start.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CLINIC_SLUG } from "@/lib/constants";
import {
  PLATFORM_CLINIC_SLUG,
  isPlatformClinic,
} from "@/server/platform/subscription-lifecycle";

const DAY = 24 * 60 * 60 * 1000;
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

type Row = {
  id: string;
  clinicId: string;
  planId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  graceEndsAt: Date | null;
  cancelledAt: Date | null;
  clinic: { slug: string };
};

const db = vi.hoisted(() => ({
  subs: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  selects: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/queue", () => ({ getQueue: () => ({}) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      // Every row the scheduler's OR could select; the step rule decides.
      findMany: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
        db.selects.push(select);
        return db.subs.map((s) => ({ ...s }));
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const s = db.subs.find((x) => x.id === where.id);
          if (!s) return { count: 0 };
          Object.assign(s, data);
          return { count: 1 };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.audits.push(data);
        return data;
      }),
    },
  },
}));

function seed(partial: Partial<Row> & { id: string; slug: string }): void {
  const { slug, ...rest } = partial;
  db.subs.push({
    clinicId: `c_${slug}`,
    planId: "plan_pro",
    status: "TRIAL",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    graceEndsAt: null,
    cancelledAt: null,
    clinic: { slug },
    ...rest,
  });
}

const statusOf = (id: string) => db.subs.find((s) => s.id === id)!.status;

beforeEach(() => {
  db.subs = [];
  db.audits = [];
  db.selects = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the platform owner's clinic is the public site's clinic", () => {
  it("NeuroFax on production, and nothing else matches", () => {
    expect(PLATFORM_CLINIC_SLUG).toBe(DEFAULT_CLINIC_SLUG);
    expect(isPlatformClinic(PLATFORM_CLINIC_SLUG)).toBe(true);
    expect(isPlatformClinic("clinic-b")).toBe(false);
    expect(isPlatformClinic("")).toBe(false);
    expect(isPlatformClinic(null)).toBe(false);
    expect(isPlatformClinic(undefined)).toBe(false);
  });
});

describe("the scheduler never steps the platform owner's clinic", () => {
  it("NeuroFax left PAST_DUE by the old scheduler stays PAST_DUE; another clinic moves", async () => {
    const may = new Date("2026-05-31T00:00:00Z");
    seed({ id: "sub_nf", slug: PLATFORM_CLINIC_SLUG, status: "PAST_DUE", trialEndsAt: may });
    seed({ id: "sub_b", slug: "clinic-b", status: "PAST_DUE", trialEndsAt: may });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { _tickForTests } = await import("@/server/workers/trial-expiry-scheduler");
    await _tickForTests();

    // The tick reads the clinic's slug to know.
    expect(db.selects[0]).toMatchObject({ clinic: { select: { slug: true } } });
    expect(statusOf("sub_nf")).toBe("PAST_DUE");
    expect(db.subs.find((s) => s.id === "sub_nf")!.graceEndsAt).toBeNull();
    expect(db.subs.find((s) => s.id === "sub_b")!.graceEndsAt).toBeInstanceOf(Date);
    expect(db.audits.map((a) => a.entityId)).toEqual(["sub_b"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("platform owner's clinic");
    expect(String(warn.mock.calls[0]![0])).toContain("subscription-lifecycle-dryrun.ts");
  });

  it("not even once its grace ran out: never CANCELLED, so the quota guard never blocks it", async () => {
    const past = new Date(Date.now() - DAY);
    seed({ id: "sub_nf2", slug: PLATFORM_CLINIC_SLUG, status: "PAST_DUE", graceEndsAt: past });
    seed({ id: "sub_b2", slug: "clinic-b", status: "PAST_DUE", graceEndsAt: past });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { _tickForTests } = await import("@/server/workers/trial-expiry-scheduler");
    await _tickForTests();
    await _tickForTests();

    expect(statusOf("sub_nf2")).toBe("PAST_DUE");
    expect(statusOf("sub_b2")).toBe("CANCELLED");
    expect(db.audits.filter((a) => a.entityId === "sub_nf2")).toEqual([]);
    // Named once per worker start, not every minute.
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("sub_nf2"))).toHaveLength(1);
  });
});

describe("the deploy runs the dry run after the migration and before the new containers", () => {
  it("ops/deploy.sh: migrate, then the precheck, then up -d; a failure stops it", () => {
    const sh = read("ops/deploy.sh");
    const migrate = sh.indexOf("run --rm --no-deps worker npx prisma migrate deploy");
    const precheck = sh.indexOf(
      "run --rm --no-deps worker npx tsx scripts/subscription-lifecycle-dryrun.ts",
    );
    const up = sh.indexOf("\ndocker compose up -d --remove-orphans");
    expect(migrate).toBeGreaterThan(0);
    expect(precheck).toBeGreaterThan(migrate);
    expect(up).toBeGreaterThan(precheck);
    const between = sh.slice(migrate, up);
    // Both steps stop the deploy instead of warning past it.
    expect(between.match(/exit 1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(between).toContain('"$precheck" -ne 0');
    expect(sh).not.toContain("WARN: prisma migrate deploy failed");
  });

  it("DEPLOY.md: _deploy.sh chains [migrate], [precheck], [recreate] with &&", () => {
    const md = read("docs/operations/DEPLOY.md");
    const block = md.slice(md.indexOf('echo "[build]'), md.indexOf("PIPELINE_OK"));
    const m = block.indexOf("npx prisma migrate deploy &&");
    const p = block.indexOf("npx tsx scripts/subscription-lifecycle-dryrun.ts &&");
    const r = block.indexOf("up -d --no-deps --force-recreate app worker");
    expect(m).toBeGreaterThan(0);
    expect(p).toBeGreaterThan(m);
    expect(r).toBeGreaterThan(p);
    expect(md).toContain("### Шаг 0. Проверка подписок (precheck)");
    expect(md).toContain("-e APPLY=1 -e CLINIC=neurofax -e PLAN=pro");
  });

  it("GO-LIVE.md and the RUNBOOK's manual migration name the precheck too", () => {
    expect(read("docs/operations/GO-LIVE.md")).toContain("[precheck]");
    const runbook = read("docs/operations/RUNBOOK.md");
    const manual = runbook.slice(runbook.indexOf("### 3.6"), runbook.indexOf("### 3.7"));
    expect(manual.indexOf("subscription-lifecycle-dryrun.ts")).toBeGreaterThan(
      manual.indexOf("npx prisma migrate deploy"),
    );
    expect(manual.indexOf("subscription-lifecycle-dryrun.ts")).toBeLessThan(
      manual.indexOf("--force-recreate app worker"),
    );
  });
});
