import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REAL_DATA_OPT_IN_ENV,
  REAL_WORK_ACTIONS,
  assertSeedAllowed,
  decideSeedGuard,
  hasRealData,
  probeRealData,
  type SeedGuardDb,
  type SeedPolicy,
} from "../../scripts/_destructive-guard";

/**
 * Audit G2-02 / G2-03 / G2-06 / G2-07: production is the real clinic, and
 * every demo or test seed goes through ONE guard before its first write.
 */

const CLEAN = { staffActions: 0, recentActivity: 0 };
const REAL = { staffActions: 312, recentActivity: 0 };
const demo: SeedPolicy = { script: "seed-demo-data", clinicSlug: "neurofax" };

describe("decideSeedGuard", () => {
  it("lets a demo seed write to a clean local clinic, with no warning", () => {
    const d = decideSeedGuard({ policy: demo, signals: CLEAN, env: {}, argv: [] });
    expect(d).toEqual({ ok: true, realData: false, warning: null });
  });

  it("refuses a clinic with staff work unless the opt-in names that clinic", () => {
    const refused = decideSeedGuard({ policy: demo, signals: REAL, env: {}, argv: [] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("real_data");
      expect(refused.message).toContain(`${REAL_DATA_OPT_IN_ENV}=neurofax`);
    }

    const otherClinic = decideSeedGuard({
      policy: demo,
      signals: REAL,
      env: { [REAL_DATA_OPT_IN_ENV]: "demo-clinic" },
      argv: [],
    });
    expect(otherClinic.ok).toBe(false);

    const named = decideSeedGuard({
      policy: demo,
      signals: REAL,
      env: { [REAL_DATA_OPT_IN_ENV]: "neurofax" },
      argv: [],
    });
    expect(named).toMatchObject({ ok: true, realData: true });
    if (named.ok) expect(named.warning).toContain("neurofax");
  });

  it("no longer accepts the old --i-know-there-is-real-data flag", () => {
    const d = decideSeedGuard({
      policy: { ...demo, destructive: true },
      signals: REAL,
      env: {},
      argv: ["--force", "--i-know-there-is-real-data"],
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toContain("больше не действует");
  });

  it("treats NODE_ENV=production as real even when the probe finds nothing", () => {
    const d = decideSeedGuard({
      policy: demo,
      signals: CLEAN,
      env: { NODE_ENV: "production" },
      argv: [],
    });
    expect(d).toMatchObject({ ok: false, reason: "real_data" });
  });

  it("refuses dev-only scripts in production with no override", () => {
    const d = decideSeedGuard({
      policy: { script: "seed-labs-reminders-dev", clinicSlug: "neurofax", devOnly: true },
      signals: CLEAN,
      env: { NODE_ENV: "production", [REAL_DATA_OPT_IN_ENV]: "neurofax" },
      argv: ["--force"],
    });
    expect(d).toMatchObject({ ok: false, reason: "dev_only_in_production" });
  });

  it("requires --force from a script that deletes rows, before anything else", () => {
    const policy = { ...demo, destructive: true };
    expect(decideSeedGuard({ policy, signals: CLEAN, env: {}, argv: [] })).toMatchObject({
      ok: false,
      reason: "needs_force",
    });
    expect(decideSeedGuard({ policy, signals: CLEAN, env: {}, argv: ["--force"] }).ok).toBe(true);
  });

  it("gives a script that signs as the clinic's doctors no opt-in on real data", () => {
    const d = decideSeedGuard({
      policy: {
        script: "seed-clinical-life",
        clinicSlug: "neurofax",
        destructive: true,
        devOnly: true,
        neverOnRealData: true,
      },
      signals: REAL,
      env: { [REAL_DATA_OPT_IN_ENV]: "neurofax" },
      argv: ["--force"],
    });
    expect(d).toMatchObject({ ok: false, reason: "real_data" });
  });

  it("counts heavy recent activity as real data too", () => {
    expect(hasRealData({ staffActions: 0, recentActivity: 19 })).toBe(false);
    expect(hasRealData({ staffActions: 0, recentActivity: 20 })).toBe(true);
    expect(hasRealData({ staffActions: 1, recentActivity: 0 })).toBe(true);
  });
});

describe("probeRealData", () => {
  it("counts staff rows of this clinic for app-only actions, and recent rows overall", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db: SeedGuardDb = {
      clinic: { findUnique: async () => ({ id: "c1" }) },
      auditLog: {
        count: async ({ where }) => {
          calls.push(where);
          return 3;
        },
      },
    };
    const now = new Date("2026-09-26T08:00:00Z");
    const s = await probeRealData(db, "c1", now);
    expect(s).toEqual({ staffActions: 3, recentActivity: 3 });
    expect(calls[0]).toEqual({
      clinicId: "c1",
      actorId: { not: null },
      action: { in: [...REAL_WORK_ACTIONS] },
    });
    expect(calls[1]).toEqual({
      createdAt: { gte: new Date("2026-09-23T08:00:00Z") },
    });
  });

  it("does not count the actions old seeds forged into the audit log", () => {
    for (const forged of [
      "user.signin",
      "appointment.create",
      "appointment.update",
      "appointment.complete",
      "payment.create",
      "visitnote.finalize",
      "patient.update",
      "document.upload",
    ]) {
      expect(REAL_WORK_ACTIONS as readonly string[]).not.toContain(forged);
    }
    expect(REAL_WORK_ACTIONS).toContain("appointment.walkin_issued");
    expect(REAL_WORK_ACTIONS).toContain("visit_note.finalize");
    expect(REAL_WORK_ACTIONS).toContain("patient.create");
  });
});

describe("assertSeedAllowed", () => {
  afterEach(() => vi.restoreAllMocks());

  function exitSpy() {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
  }

  it("stops the process on a clinic with real data", async () => {
    const exit = exitSpy();
    const db: SeedGuardDb = {
      clinic: { findUnique: async () => ({ id: "c1" }) },
      auditLog: { count: async () => 50 },
    };
    await expect(assertSeedAllowed(db, demo, {}, [])).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses a dev-only script in production without touching the database", async () => {
    exitSpy();
    const findUnique = vi.fn(async () => ({ id: "c1" }));
    const db: SeedGuardDb = { clinic: { findUnique }, auditLog: { count: async () => 0 } };
    await expect(
      assertSeedAllowed(db, { ...demo, devOnly: true }, { NODE_ENV: "production" }, []),
    ).rejects.toThrow("exit 1");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns the clinic id when the clinic is clean", async () => {
    const db: SeedGuardDb = {
      clinic: { findUnique: async () => ({ id: "c9" }) },
      auditLog: { count: async () => 0 },
    };
    await expect(assertSeedAllowed(db, demo, {}, [])).resolves.toEqual({
      clinicId: "c9",
      realData: false,
    });
  });
});

describe("the scripts use the guard", () => {
  const read = (f: string) =>
    readFileSync(path.resolve(__dirname, "../../scripts", f), "utf8");

  it.each([
    "seed-demo-data.ts",
    "seed-clinical-life.ts",
    "seed-labs-reminders-dev.ts",
    "seed-today-live.ts",
    "seed-mega-neurofax.ts",
    "wipe-neurofax-demo.ts",
    "seed-prod-demo.ts",
    "seed-doctor-qa.ts",
    "seed-joe-two.ts",
    "total-stress-seed.ts",
    "stress-appointments.ts",
    "stress-cases-scenarios.ts",
    "stress-medical-cases.ts",
    "stress-reminders-scenarios.ts",
  ])("%s calls assertSeedAllowed", (f) => {
    expect(read(f)).toMatch(/assertSeedAllowed\(/);
  });

  it("dev-only tooling declares devOnly", () => {
    for (const f of ["seed-labs-reminders-dev.ts", "seed-clinical-life.ts", "total-stress-seed.ts"]) {
      expect(read(f)).toMatch(/devOnly: true/);
    }
  });

  it.each([
    "import-clinic-formulary.ts",
    "backfill-clinic-diagnoses.ts",
    "close-stale-in-progress-visits.ts",
    "fix-q12-ticket-prefixes.ts",
    "fix-g4-06-reference-dosing-instructions.ts",
  ])("the production data fix %s is not blocked by it", (f) => {
    expect(read(f)).not.toMatch(/_destructive-guard/);
  });

  it("seed-demo-data and seed-clinical-life have no default clinic", () => {
    for (const f of ["seed-demo-data.ts", "seed-clinical-life.ts", "seed-labs-reminders-dev.ts"]) {
      const src = read(f);
      expect(src).toMatch(/requireClinicSlug\(/);
      expect(src).not.toMatch(/CLINIC_SLUG \?\? "neurofax"/);
    }
  });

  it("seed-clinical-life neither writes nor deletes audit rows (G2-06)", () => {
    expect(read("seed-clinical-life.ts")).not.toMatch(/auditLog\./);
    expect(read("seed-clinical-life.ts")).toMatch(/neverOnRealData: true/);
  });

  it("seed-labs-reminders-dev no longer walks every clinic (G2-02)", () => {
    const src = read("seed-labs-reminders-dev.ts");
    expect(src).not.toMatch(/clinic\.findMany/);
    expect(src).toMatch(/tags: \{ has: DEMO_SEED_MARK \}/);
  });

  it("the worker image leaves the test seeds out (G2-02)", () => {
    const docker = readFileSync(path.resolve(__dirname, "../../Dockerfile.worker"), "utf8");
    expect(docker).toMatch(/rm -f scripts\/seed-labs-reminders-dev\.ts/);
    expect(docker).toMatch(/scripts\/stress-\*\.ts/);
  });
});
