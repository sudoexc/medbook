import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REAL_DATA_OPT_IN_ENV,
  REAL_WORK_ACTIONS,
  assertLocalHttpTarget,
  assertSeedAllowed,
  assertSeedAllowedOrNewClinic,
  decideSeedGuard,
  hasRealData,
  isLocalHttpTarget,
  probeRealData,
  type SeedGuardDb,
  type SeedPolicy,
} from "../../scripts/_destructive-guard";

/**
 * Audit G2-02 / G2-03 / G2-06 / G2-07: production is the real clinic, and
 * every demo or test seed goes through ONE guard before its first write.
 */

const CLEAN = { staffActions: 0, recentActivity: 0, signedConclusions: 0 };
const REAL = { staffActions: 312, recentActivity: 0, signedConclusions: 0 };
/** A copy of production: signed conclusions, audit trail gone or quiet. */
const SIGNED = { staffActions: 0, recentActivity: 0, signedConclusions: 4821 };
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
      // The hint is a placeholder: the refused slug is never spelled out as
      // a ready-to-paste bypass (review of 895cded).
      expect(refused.message).toContain(`${REAL_DATA_OPT_IN_ENV}=<slug демо-клиники>`);
      expect(refused.message).not.toContain("=neurofax");
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

  it("refuses a destructive seed in production with no opt-in and no --force hint", () => {
    for (const script of ["seed-mega-neurofax", "wipe-neurofax-demo", "seed-today-live"]) {
      const d = decideSeedGuard({
        policy: { script, clinicSlug: "neurofax", destructive: true },
        signals: REAL,
        env: { NODE_ENV: "production", [REAL_DATA_OPT_IN_ENV]: "neurofax" },
        argv: ["--force"],
      });
      expect(d).toMatchObject({ ok: false, reason: "destructive_in_production" });
      // Without --force it refuses the same way: the old «add --force» hint
      // was the first step towards the bypass.
      const bare = decideSeedGuard({
        policy: { script, clinicSlug: "neurofax", destructive: true },
        signals: CLEAN,
        env: { NODE_ENV: "production" },
        argv: [],
      });
      expect(bare).toMatchObject({ ok: false, reason: "destructive_in_production" });
      if (!bare.ok) expect(bare.message).not.toContain("--force\n");
    }
  });

  it("never prints a ready opt-in for the clinic it refuses", () => {
    const policies: SeedPolicy[] = [
      demo,
      { ...demo, destructive: true },
      { script: "seed-mega-neurofax", clinicSlug: "neurofax", destructive: true, devOnly: true },
      { script: "seed-prod-demo", clinicSlug: "neurofax" },
    ];
    const cases = [
      { signals: REAL, env: {}, argv: ["--force"] },
      { signals: CLEAN, env: { NODE_ENV: "production" }, argv: ["--force"] },
      { signals: REAL, env: { NODE_ENV: "production" }, argv: [] },
      { signals: REAL, env: { [REAL_DATA_OPT_IN_ENV]: "demo-clinic" }, argv: ["--force"] },
    ];
    for (const policy of policies) {
      for (const c of cases) {
        const d = decideSeedGuard({ policy, ...c });
        expect(d.ok).toBe(false);
        if (!d.ok) expect(d.message).not.toContain("=neurofax");
      }
    }
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
    expect(hasRealData({ ...CLEAN, recentActivity: 19 })).toBe(false);
    expect(hasRealData({ ...CLEAN, recentActivity: 20 })).toBe(true);
    expect(hasRealData({ ...CLEAN, staffActions: 1 })).toBe(true);
    expect(hasRealData({ ...CLEAN, signedConclusions: 1 })).toBe(true);
  });

  // Audit G2-05 acceptance: on a copy of the production database with signed
  // conclusions every destructive script refuses, whatever the audit trail
  // says, in any environment, with any opt-in.
  it("refuses every destructive script on a clinic with signed conclusions, no bypass", () => {
    for (const script of [
      "wipe-neurofax-demo",
      "seed-mega-neurofax",
      "seed-today-live",
      "cleanup-test-conversations",
    ]) {
      for (const env of [
        {},
        { NODE_ENV: "development" },
        { [REAL_DATA_OPT_IN_ENV]: "neurofax" },
      ]) {
        const d = decideSeedGuard({
          policy: { script, clinicSlug: "neurofax", destructive: true },
          signals: SIGNED,
          env,
          argv: ["--force", "--i-know-there-is-real-data"],
        });
        expect(d).toMatchObject({ ok: false, reason: "signed_documents" });
        if (!d.ok) {
          expect(d.message).not.toContain("=neurofax");
          expect(d.message).not.toContain(REAL_DATA_OPT_IN_ENV);
        }
      }
    }
  });

  it("an additive seed on a clinic with signed conclusions still needs the named opt-in", () => {
    const refused = decideSeedGuard({ policy: demo, signals: SIGNED, env: {}, argv: [] });
    expect(refused).toMatchObject({ ok: false, reason: "real_data" });
    const named = decideSeedGuard({
      policy: demo,
      signals: SIGNED,
      env: { [REAL_DATA_OPT_IN_ENV]: "neurofax" },
      argv: [],
    });
    expect(named.ok).toBe(true);
  });

  it("a clinic with real data never gets the «add --force» hint first", () => {
    const d = decideSeedGuard({
      policy: { ...demo, destructive: true },
      signals: REAL,
      env: {},
      argv: [],
    });
    expect(d).toMatchObject({ ok: false, reason: "real_data" });
    if (!d.ok) expect(d.message).not.toMatch(/Без флага --force/);
  });
});

function dbWith(opts: {
  clinic?: { id: string } | null;
  audit?: number;
  signed?: number;
  findUnique?: SeedGuardDb["clinic"]["findUnique"];
}): SeedGuardDb {
  return {
    clinic: {
      findUnique:
        opts.findUnique ?? (async () => (opts.clinic === undefined ? { id: "c1" } : opts.clinic)),
    },
    auditLog: { count: async () => opts.audit ?? 0 },
    visitNoteRevision: { count: async () => opts.signed ?? 0 },
  };
}

describe("probeRealData", () => {
  it("counts staff rows of this clinic, people's recent rows overall, and signed conclusions", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const revisionCalls: Array<Record<string, unknown>> = [];
    const db: SeedGuardDb = {
      clinic: { findUnique: async () => ({ id: "c1" }) },
      auditLog: {
        count: async ({ where }) => {
          calls.push(where);
          return 3;
        },
      },
      visitNoteRevision: {
        count: async ({ where }) => {
          revisionCalls.push(where);
          return 7;
        },
      },
    };
    const now = new Date("2026-09-26T08:00:00Z");
    const s = await probeRealData(db, "c1", now);
    expect(s).toEqual({ staffActions: 3, recentActivity: 3, signedConclusions: 7 });
    expect(calls[0]).toEqual({
      clinicId: "c1",
      actorId: { not: null },
      action: { in: [...REAL_WORK_ACTIONS] },
    });
    // People only: the outbox mirror and the no-show sweep write rows with no
    // actor around the clock and made a clean demo look «real» (G2-05).
    expect(calls[1]).toEqual({
      createdAt: { gte: new Date("2026-09-23T08:00:00Z") },
      actorId: { not: null },
    });
    // Audit-independent: only the finalize route writes SIGNED revisions.
    // Demo patients' conclusions (signed while showing the demo) do not count.
    expect(revisionCalls[0]).toEqual({
      clinicId: "c1",
      kind: "SIGNED",
      visitNote: { patient: { NOT: { tags: { has: "demo-seed" } } } },
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
    await expect(assertSeedAllowed(dbWith({ audit: 50 }), demo, {}, [])).rejects.toThrow(
      "exit 1",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("stops a destructive script on a clinic with signed conclusions and an empty audit log", async () => {
    exitSpy();
    await expect(
      assertSeedAllowed(
        dbWith({ audit: 0, signed: 12 }),
        { ...demo, destructive: true },
        { [REAL_DATA_OPT_IN_ENV]: "neurofax" },
        ["--force"],
      ),
    ).rejects.toThrow("exit 1");
  });

  it("refuses a dev-only script in production without touching the database", async () => {
    exitSpy();
    const findUnique = vi.fn(async () => ({ id: "c1" }));
    const db = dbWith({ findUnique });
    await expect(
      assertSeedAllowed(db, { ...demo, devOnly: true }, { NODE_ENV: "production" }, []),
    ).rejects.toThrow("exit 1");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("refuses a destructive seed in production without touching the database", async () => {
    exitSpy();
    const findUnique = vi.fn(async () => ({ id: "c1" }));
    const db = dbWith({ findUnique });
    await expect(
      assertSeedAllowed(
        db,
        { ...demo, destructive: true },
        { NODE_ENV: "production", [REAL_DATA_OPT_IN_ENV]: "neurofax" },
        ["--force"],
      ),
    ).rejects.toThrow("exit 1");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns the clinic id when the clinic is clean", async () => {
    await expect(assertSeedAllowed(dbWith({ clinic: { id: "c9" } }), demo, {}, [])).resolves.toEqual({
      clinicId: "c9",
      realData: false,
    });
  });

  it("lets prisma/seed.ts create a clinic that does not exist yet, and guards one that does", async () => {
    exitSpy();
    const policy = { script: "prisma/seed", clinicSlug: "neurofax", devOnly: true };
    await expect(
      assertSeedAllowedOrNewClinic(dbWith({ clinic: null }), policy, {}, []),
    ).resolves.toEqual({ clinicId: null, realData: false });
    await expect(
      assertSeedAllowedOrNewClinic(dbWith({ signed: 3 }), policy, {}, []),
    ).rejects.toThrow("exit 1");
    await expect(
      assertSeedAllowedOrNewClinic(dbWith({ clinic: null }), policy, { NODE_ENV: "production" }, []),
    ).rejects.toThrow("exit 1");
  });
});

describe("HTTP stress scripts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("run only against the local app", () => {
    expect(isLocalHttpTarget("http://localhost:3000")).toBe(true);
    expect(isLocalHttpTarget("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalHttpTarget("https://neurofax.uz")).toBe(false);
    expect(isLocalHttpTarget("http://localhost.neurofax.uz")).toBe(false);
    expect(isLocalHttpTarget("not a url")).toBe(false);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    expect(() => assertLocalHttpTarget("s", "http://localhost:3000", {})).not.toThrow();
    expect(() => assertLocalHttpTarget("s", "https://neurofax.uz", {})).toThrow("exit 1");
    expect(() =>
      assertLocalHttpTarget("s", "http://localhost:3000", { NODE_ENV: "production" }),
    ).toThrow("exit 1");
    expect(exit).toHaveBeenCalledTimes(2);
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
    // Audit G2-05: the destructive and demo scripts P2 left unguarded.
    "fix-double-inprogress.ts",
    "guard-e2e.ts",
    "cleanup-test-conversations.ts",
  ])("%s calls assertSeedAllowed", (f) => {
    expect(read(f)).toMatch(/assertSeedAllowed\(/);
  });

  it("prisma/seed.ts goes through the guard before its first write", () => {
    const src = readFileSync(path.resolve(__dirname, "../../prisma/seed.ts"), "utf8");
    const guard = src.indexOf("assertSeedAllowedOrNewClinic(prisma");
    expect(guard).toBeGreaterThan(0);
    expect(src.slice(guard, guard + 300)).toMatch(/devOnly: true/);
    // Before the first upsert of main().
    expect(guard).toBeLessThan(src.indexOf('await upsertStaff("super@neurofax.uz"'));
  });

  it("the HTTP stress scripts refuse a non-local target", () => {
    for (const f of ["stress-payments-analytics-ai.ts", "stress-settings-crud.ts"]) {
      expect(read(f)).toMatch(/assertLocalHttpTarget\(/);
    }
  });

  it("cleanup-test-conversations is scoped to one named clinic and marked destructive", () => {
    const src = read("cleanup-test-conversations.ts");
    expect(src).toMatch(/requireClinicSlug\(/);
    expect(src).toMatch(/destructive: true/);
    expect(src).toMatch(/where: \{ clinicId: clinic\.id \}/);
  });

  it("the preset seeds no longer erase doctors' own presets", () => {
    const presets = readFileSync(path.resolve(__dirname, "../../prisma/seed-presets.ts"), "utf8");
    expect(presets).not.toMatch(/doctorPreset\.deleteMany/);
    const sql = readFileSync(path.resolve(__dirname, "../../prisma/seed-presets-sql.ts"), "utf8");
    expect(sql).not.toMatch(/DELETE FROM "DoctorPreset"/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "DoctorPreset"/);
  });

  it("dev-only tooling declares devOnly", () => {
    for (const f of [
      "seed-labs-reminders-dev.ts",
      "seed-clinical-life.ts",
      "total-stress-seed.ts",
      // Hard-wired to slug neurofax: their only possible production target
      // is the real clinic (review of 895cded).
      "seed-mega-neurofax.ts",
      "wipe-neurofax-demo.ts",
      "fix-double-inprogress.ts",
      "guard-e2e.ts",
    ]) {
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

  it("the worker image copies only the allowlisted scripts (G2-02, G2-03, G2-05)", () => {
    const docker = readFileSync(path.resolve(__dirname, "../../Dockerfile.worker"), "utf8");
    expect(docker).toMatch(/worker-allowlist\.txt/);
    expect(docker).toMatch(/xargs cp --parents -t \/opt\/ops-scripts/);
    expect(docker).toMatch(/COPY --from=builder --chown=worker:nodejs \/opt\/ops-scripts +\.\/scripts/);
    expect(docker).not.toMatch(/\/app\/scripts/);
  });
});

describe("the worker allowlist (G2-05)", () => {
  const scriptsDir = path.resolve(__dirname, "../../scripts");
  const read = (f: string) => readFileSync(path.join(scriptsDir, f), "utf8");
  const listed = read("worker-allowlist.txt")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  it("names only files that exist", () => {
    expect(listed.length).toBeGreaterThan(20);
    for (const f of listed) expect(existsSync(path.join(scriptsDir, f)), f).toBe(true);
  });

  it("carries every script-local import of what it lists", () => {
    const set = new Set(listed);
    for (const f of listed) {
      for (const m of read(f).matchAll(/from "(\.\/[^"]+)"/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]!));
        expect(set.has(`${target}.ts`), `${f} imports ${m[1]}`).toBe(true);
      }
    }
  });

  it("holds no demo, test or destructive tooling", () => {
    for (const f of listed) {
      const src = read(f);
      expect(src, f).not.toMatch(/_destructive-guard/);
      expect(src, f).not.toMatch(/assertSeedAllowed/);
    }
    for (const f of [
      "seed-mega-neurofax.ts",
      "wipe-neurofax-demo.ts",
      "seed-today-live.ts",
      "seed-demo-data.ts",
      "seed-prod-demo.ts",
      "seed-clinical-life.ts",
      "seed-labs-reminders-dev.ts",
      "fix-double-inprogress.ts",
      "guard-e2e.ts",
      "cleanup-test-conversations.ts",
      "upsert-dev-admin.ts",
      "_destructive-guard.ts",
    ]) {
      expect(listed, f).not.toContain(f);
    }
    expect(listed.some((f) => f.startsWith("stress-"))).toBe(false);
  });

  it("lists every production data fix, so none is missing on the server", () => {
    const fixes = readdirSync(scriptsDir).filter(
      (f) => /^(fix|backfill)-.*\.ts$/.test(f) && !/devOnly: true/.test(read(f)),
    );
    expect(fixes.length).toBeGreaterThan(10);
    for (const f of fixes) expect(listed, f).toContain(f);
  });
});
