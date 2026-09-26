import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEMO_APPOINTMENT_NOTE } from "../../scripts/_demo-seed-plan";
import { LABS_REMINDERS_MARK, planLabsReminders } from "../../scripts/_labs-reminders-plan";
import { todayDemoAppointmentsWhere } from "../../scripts/_live-queue-seed";
import { tashkentDayBounds } from "../../src/lib/booking-validation";
import { DEMO_SEED_MARK } from "../../src/lib/demo-seed";

const read = (f: string) => readFileSync(path.resolve(__dirname, "../../scripts", f), "utf8");

/**
 * Audit G2-02: the labs/reminders dev seed gave REAL patients invented
 * results (a CRITICAL cholesterol) with nothing marking the rows.
 */
describe("planLabsReminders", () => {
  const demo = [
    { id: "p-demo-1", tags: [DEMO_SEED_MARK] },
    { id: "p-demo-2", tags: ["demo:", DEMO_SEED_MARK] },
  ];
  const real = { id: "p-real", tags: ["vip"] };
  let n = 0;
  const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);

  it("names only demo patients and marks every row", () => {
    const plan = planLabsReminders({
      doctorIds: ["u1", "u2"],
      patients: [real, ...demo],
      seededByDoctor: new Map(),
      now: new Date("2026-09-26T05:00:00Z"),
      random,
    });
    expect(plan.reminders.length).toBe(6);
    expect(plan.labs.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(demo.map((p) => p.id));
    for (const r of plan.reminders) {
      expect(ids.has(r.patientId)).toBe(true);
      expect(r.body).toBe(LABS_REMINDERS_MARK);
    }
    for (const l of plan.labs) {
      expect(ids.has(l.patientId)).toBe(true);
      expect(l.notes).toBe(LABS_REMINDERS_MARK);
    }
  });

  it("writes nothing when the clinic has no demo patients", () => {
    const plan = planLabsReminders({
      doctorIds: ["u1"],
      patients: [real],
      seededByDoctor: new Map(),
      now: new Date(),
    });
    expect(plan).toEqual({ reminders: [], labs: [] });
  });

  it("adds nothing for a doctor who already has marked rows", () => {
    const plan = planLabsReminders({
      doctorIds: ["u1"],
      patients: demo,
      seededByDoctor: new Map([["u1", { reminders: 3, labs: 4 }]]),
      now: new Date(),
    });
    expect(plan).toEqual({ reminders: [], labs: [] });
  });

  it("the marker is specific to this seed", () => {
    expect(LABS_REMINDERS_MARK).toBe("[demo-seed:labs-reminders-dev]");
  });
});

/**
 * Audit G2-03: seed-today-live deleted EVERY appointment of the day (signed
 * conclusions and payments with them) and dealt real patients into the fake
 * queue.
 */
describe("seed-today-live scope", () => {
  it("clears only today's demo-marked appointments", () => {
    const now = new Date("2026-09-26T05:00:00Z");
    const { dayStart, dayEnd } = tashkentDayBounds(now);
    expect(todayDemoAppointmentsWhere("c1", now)).toEqual({
      clinicId: "c1",
      date: { gte: dayStart, lt: dayEnd },
      notes: DEMO_APPOINTMENT_NOTE,
    });
  });

  it("marks every row the live-queue builder creates", () => {
    expect(read("_live-queue-seed.ts")).toMatch(/notes: DEMO_APPOINTMENT_NOTE,/);
    expect(read("_live-queue-seed.ts")).toMatch(/where: todayDemoAppointmentsWhere\(clinicId, now\)/);
  });

  it("takes only demo patients and goes through the guard with --force", () => {
    const src = read("seed-today-live.ts");
    expect(src).toMatch(/tags: \{ has: DEMO_SEED_MARK \}/);
    expect(src).not.toMatch(/where: \{ clinicId \},\n\s+select: \{ id: true \},\n\s+take: 2000/);
    expect(src).toMatch(/destructive: true/);
  });
});

describe("RUNBOOK §5 (G2-03)", () => {
  const runbook = readFileSync(
    path.resolve(__dirname, "../../docs/operations/RUNBOOK.md"),
    "utf8",
  );

  it("no longer calls production a demo", () => {
    expect(runbook).not.toMatch(/реальных пациентов нет/);
    expect(runbook).not.toMatch(/пока прод демо/);
    expect(runbook).not.toMatch(/демо-окружение/);
  });

  it("gives no command that runs a demo seed on the server", () => {
    const serverCommands = runbook
      .split("\n")
      .filter((l) => l.includes("ssh root@") || l.includes("docker compose exec"));
    for (const l of serverCommands) {
      expect(l).not.toMatch(/seed-(today-live|mega-neurofax|demo-data|clinical-life|prod-demo)|wipe-neurofax-demo/);
    }
  });

  it("checks the backup where backup.sh writes it", () => {
    expect(runbook).not.toMatch(/medbook-backups\/backups/);
    expect(runbook).toMatch(/ls -lh \/var\/backups\/medbook/);
  });
});
