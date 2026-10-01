/**
 * Audit G2-09: wipe-neurofax-demo and seed-mega-neurofax left the clinic
 * half wiped and broke patient registration.
 *
 * Their hand-written table lists had no Referral (patient link ON DELETE
 * RESTRICT): with one referral in the clinic DELETE FROM "Patient" failed,
 * the error was printed as a warning after visits and payments were gone,
 * and patientCounter was reset to 0 next to patients 1..N, so every new card
 * collided on the unique number. Pinned here:
 *   - one shared list (scripts/_demo-wipe.ts) that lists Referral before
 *     Patient and every RESTRICT child before its parent, against the schema;
 *   - the live foreign keys are checked before the first DELETE;
 *   - all DELETEs run in one transaction and a failure is thrown, not eaten;
 *   - the counter becomes the highest patient number left, never a blind 0.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLINIC_WIPE_ORDER,
  wipeClinicDemoData,
  wipeOrderProblems,
  type FkEdge,
} from "../../scripts/_demo-wipe";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const schema = read("prisma/schema.prisma");

type Relation = { model: string; target: string; optional: boolean; onDelete: string | null };

/** Every `@relation` in the schema, with its onDelete. */
function relations(): Relation[] {
  const out: Relation[] = [];
  let model = "";
  for (const line of schema.split("\n")) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) {
      model = m[1]!;
      continue;
    }
    const r = /^\s+\w+\s+(\w+)(\?)?\s+@relation\((.*)\)/.exec(line);
    if (!r || !model) continue;
    const onDelete = /onDelete:\s*(\w+)/.exec(r[3]!)?.[1] ?? null;
    out.push({ model, target: r[1]!, optional: r[2] === "?", onDelete });
  }
  return out;
}

const order = CLINIC_WIPE_ORDER as readonly string[];
const pos = (t: string) => order.indexOf(t);

describe("CLINIC_WIPE_ORDER against prisma/schema.prisma", () => {
  it("deletes Referral before Patient", () => {
    expect(pos("Referral")).toBeGreaterThanOrEqual(0);
    expect(pos("Referral")).toBeLessThan(pos("Patient"));
  });

  it("deletes every row that would block a listed parent before that parent", () => {
    // Required relations default to Restrict; explicit Restrict / NoAction too.
    const blocking = relations().filter(
      (r) =>
        order.includes(r.target) &&
        r.model !== r.target &&
        ((!r.optional && r.onDelete === null) ||
          r.onDelete === "Restrict" ||
          r.onDelete === "NoAction"),
    );
    expect(blocking.map((r) => r.model)).toContain("Referral");
    for (const r of blocking) {
      expect(pos(r.model), `${r.model} → ${r.target} is not in the wipe list`).toBeGreaterThanOrEqual(0);
      expect(pos(r.model), `${r.model} must go before ${r.target}`).toBeLessThan(pos(r.target));
    }
  });

  it("keeps the real site requests (Lead)", () => {
    expect(order).not.toContain("Lead");
  });

  it("both scripts use the shared wipe instead of their own list", () => {
    for (const f of ["scripts/wipe-neurofax-demo.ts", "scripts/seed-mega-neurofax.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/wipeClinicDemoData\(prisma, clinicId\)/);
      expect(src, f).not.toMatch(/const wipeOrder = \[/);
      expect(src, f).not.toMatch(/patientCounter: 0/);
    }
  });
});

describe("wipeOrderProblems", () => {
  const all = new Set(["Patient", "Appointment", "Referral", "Lead", "VisitNoteRevision", "VisitNote"]);

  it("names a RESTRICT child the list forgot", () => {
    const edges: FkEdge[] = [{ child: "Referral", parent: "Patient", onDelete: "r" }];
    expect(wipeOrderProblems(["Appointment", "Patient"], edges, all)).toEqual([
      expect.stringContaining("Referral → Patient"),
    ]);
  });

  it("names a child listed after its parent", () => {
    const edges: FkEdge[] = [{ child: "Appointment", parent: "Patient", onDelete: "a" }];
    expect(wipeOrderProblems(["Patient", "Appointment"], edges, all)).toEqual([
      expect.stringContaining("must be deleted before"),
    ]);
  });

  it("ignores CASCADE and SET NULL links and self references", () => {
    const edges: FkEdge[] = [
      { child: "VisitNoteRevision", parent: "VisitNote", onDelete: "c" },
      { child: "Lead", parent: "Patient", onDelete: "n" },
      { child: "Patient", parent: "Patient", onDelete: "r" },
    ];
    expect(wipeOrderProblems(["VisitNote", "Patient"], edges, all)).toEqual([]);
  });

  it("names a listed child without clinicId (its rows cannot be scoped)", () => {
    const edges: FkEdge[] = [{ child: "Referral", parent: "Patient", onDelete: "r" }];
    const noClinic = new Set(["Patient"]);
    expect(wipeOrderProblems(["Referral", "Patient"], edges, noClinic)).toEqual([
      expect.stringContaining("no clinicId column"),
    ]);
  });

  it("accepts the shipped order with the schema's Referral link", () => {
    const edges: FkEdge[] = [
      { child: "Referral", parent: "Patient", onDelete: "r" },
      { child: "VisitNote", parent: "Patient", onDelete: "r" },
      { child: "Appointment", parent: "Patient", onDelete: "r" },
    ];
    expect(wipeOrderProblems(CLINIC_WIPE_ORDER, edges, new Set(CLINIC_WIPE_ORDER))).toEqual([]);
  });
});

describe("wipeClinicDemoData", () => {
  function fakeDb(opts: {
    edges?: FkEdge[];
    failOn?: string;
    maxPatientNumber?: number;
  }) {
    const log: string[] = [];
    const tx = {
      async $executeRawUnsafe(sql: string, ...values: unknown[]) {
        log.push(`${sql} [${values.join(",")}]`);
        const table = /DELETE FROM "(\w+)"/.exec(sql)?.[1];
        if (table && table === opts.failOn) {
          throw new Error(`update or delete on table "${table}" violates foreign key constraint`);
        }
        return table === "Patient" ? 3 : 0;
      },
      async $queryRawUnsafe(sql: string, ...values: unknown[]) {
        log.push(`${sql.replace(/\s+/g, " ").trim()} [${values.join(",")}]`);
        return [{ patientCounter: opts.maxPatientNumber ?? 0 }];
      },
    };
    let transactions = 0;
    const db = {
      async $queryRawUnsafe(sql: string) {
        if (sql.includes("information_schema.columns")) {
          return CLINIC_WIPE_ORDER.map((table_name) => ({ table_name }));
        }
        if (sql.includes("pg_constraint")) return opts.edges ?? [];
        throw new Error(`unexpected query ${sql}`);
      },
      async $transaction<R>(fn: (t: typeof tx) => Promise<R>) {
        transactions += 1;
        return fn(tx);
      },
    };
    return { db, log, transactions: () => transactions };
  }

  it("deletes in order inside one transaction and sets the counter from the patients left", async () => {
    const f = fakeDb({ maxPatientNumber: 0 });
    const res = await wipeClinicDemoData(f.db as never, "c1", () => undefined);
    expect(f.transactions()).toBe(1);
    const deletes = f.log.filter((l) => l.startsWith("DELETE"));
    expect(deletes).toHaveLength(CLINIC_WIPE_ORDER.length);
    expect(deletes.findIndex((l) => l.includes('"Referral"'))).toBeLessThan(
      deletes.findIndex((l) => l.includes('"Patient"')),
    );
    const counter = f.log.find((l) => l.startsWith('UPDATE "Clinic"'))!;
    expect(counter).toMatch(/MAX\("patientNumber"\)/);
    expect(counter).toMatch(/\[c1\]$/);
    expect(res).toEqual({ deleted: 3, patientCounter: 0 });
  });

  it("throws a failed DELETE instead of printing it and carrying on", async () => {
    const f = fakeDb({ failOn: "Patient" });
    await expect(wipeClinicDemoData(f.db as never, "c1", () => undefined)).rejects.toThrow(
      /violates foreign key/,
    );
    // Nothing after the failure: the counter is not touched.
    expect(f.log.some((l) => l.startsWith('UPDATE "Clinic"'))).toBe(false);
  });

  it("refuses before the first DELETE when the schema has a blocking link the list misses", async () => {
    const f = fakeDb({ edges: [{ child: "NewClinicalThing", parent: "Patient", onDelete: "r" }] });
    await expect(wipeClinicDemoData(f.db as never, "c1", () => undefined)).rejects.toThrow(
      /NewClinicalThing → Patient/,
    );
    expect(f.transactions()).toBe(0);
    expect(f.log).toEqual([]);
  });
});
