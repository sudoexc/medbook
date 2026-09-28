/**
 * Audit G2-05 (review of 23390e8): the catalog seeds in prisma/ share their
 * tables with what clinics and doctors write themselves.
 *
 * seed-protocols.ts deleted every ClinicalProtocol with a curated prefix, with
 * no clinicId / doctorId filter. Doctors save their own protocols under the
 * same prefixes (G43, M54…), so a catalog refresh on the live clinic erased
 * them. Pinned against an in-memory table: clinic and personal rows are never
 * touched, global rows are refreshed in place (ids kept for the clinic overlay
 * that hides a global protocol by id), missing ones are created as global
 * rows, a dry run writes nothing and nothing is ever deleted.
 *
 * seed-handouts.ts switched off every handout whose code is not curated, and
 * a clinic's own handouts never are.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROTOCOLS, type ProtocolSeed } from "../../prisma/_protocol-data";
import { seedGlobalProtocols, type ProtocolSeedDb } from "../../prisma/_protocol-seed";

type Row = {
  id: string;
  clinicId: string | null;
  doctorId: string | null;
  diagnosisCodePrefix: string;
  nameRu: string;
  active: boolean;
  [k: string]: unknown;
};

type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond !== null && typeof cond === "object" && "in" in cond) {
      return (cond as { in: unknown[] }).in.includes(row[k]);
    }
    return row[k] === cond;
  });
}

/** Just enough of prisma.clinicalProtocol: no deleteMany on purpose. */
function fakeDb(rows: Row[]) {
  let seq = 0;
  const writes: string[] = [];
  const clinicalProtocol = {
    async findMany(args: { where: Where }) {
      return rows.filter((r) => matches(r, args.where)).map((r) => ({ ...r }));
    },
    async update(args: { where: Where; data: Record<string, unknown> }) {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw new Error("P2025: record to update not found");
      Object.assign(row, args.data);
      writes.push(`update ${row.id}`);
      return row;
    },
    async create(args: { data: Record<string, unknown> }) {
      const row = { id: `new-${++seq}`, active: true, ...args.data } as Row;
      rows.push(row);
      writes.push(`create ${row.id}`);
      return row;
    },
  };
  return { db: { clinicalProtocol } as unknown as ProtocolSeedDb, writes };
}

const G43 = PROTOCOLS.find((p) => p.diagnosisCodePrefix === "G43")!;
const M54 = PROTOCOLS.find((p) => p.diagnosisCodePrefix === "M54")!;

function fixture(): Row[] {
  return [
    // Aziz's own protocol, saved from the doctor cabinet.
    {
      id: "aziz-g43",
      clinicId: "clinic-1",
      doctorId: "doc-aziz",
      diagnosisCodePrefix: "G43",
      nameRu: "Мигрень, моя схема",
      active: true,
    },
    // Clinic-own protocol under a curated prefix.
    {
      id: "clinic-m54",
      clinicId: "clinic-1",
      doctorId: null,
      diagnosisCodePrefix: "M54",
      nameRu: "Дорсалгия, стандарт клиники",
      active: true,
    },
    // The global G43 row a clinic may have hidden by this id.
    {
      id: "global-g43",
      clinicId: null,
      doctorId: null,
      diagnosisCodePrefix: "G43",
      nameRu: "старое название",
      active: true,
    },
  ];
}

describe("seed-protocols touches global rows only (G2-05)", () => {
  it("keeps a doctor's and the clinic's protocols byte for byte", async () => {
    const rows = fixture();
    const before = rows.slice(0, 2).map((r) => ({ ...r }));
    const { db } = fakeDb(rows);

    await seedGlobalProtocols(db, [G43, M54], { apply: true });

    expect(rows.find((r) => r.id === "aziz-g43")).toEqual(before[0]);
    expect(rows.find((r) => r.id === "clinic-m54")).toEqual(before[1]);
  });

  it("refreshes an existing global row in place and creates a missing one as global", async () => {
    const rows = fixture();
    const { db, writes } = fakeDb(rows);

    const r = await seedGlobalProtocols(db, [G43, M54], { apply: true });

    expect(r).toEqual({ created: 1, updated: 1, duplicates: [] });
    expect(writes).toEqual(["update global-g43", "create new-1"]);
    // Same id: the clinic overlay that hides it keeps working.
    expect(rows.find((x) => x.id === "global-g43")!.nameRu).toBe(G43.nameRu);
    const created = rows.find((x) => x.id === "new-1")!;
    expect(created).toMatchObject({
      clinicId: null,
      doctorId: null,
      diagnosisCodePrefix: "M54",
      nameRu: M54.nameRu,
      active: true,
    });
  });

  it("leaves a global row's active flag as it is", async () => {
    const rows = fixture();
    rows.find((r) => r.id === "global-g43")!.active = false;
    const { db } = fakeDb(rows);

    await seedGlobalProtocols(db, [G43], { apply: true });

    expect(rows.find((r) => r.id === "global-g43")!.active).toBe(false);
  });

  it("is idempotent: a second run only updates", async () => {
    const rows = fixture();
    const { db } = fakeDb(rows);
    await seedGlobalProtocols(db, PROTOCOLS, { apply: true });
    const count = rows.length;

    const again = await seedGlobalProtocols(db, PROTOCOLS, { apply: true });

    expect(again.created).toBe(0);
    expect(again.updated).toBe(PROTOCOLS.length);
    expect(rows.length).toBe(count);
  });

  it("writes nothing without APPLY", async () => {
    const rows = fixture();
    const snapshot = JSON.stringify(rows);
    const { db, writes } = fakeDb(rows);

    const r = await seedGlobalProtocols(db, [G43, M54], { apply: false });

    expect(r).toEqual({ created: 1, updated: 1, duplicates: [] });
    expect(writes).toEqual([]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("reports extra global rows of a prefix instead of deleting them", async () => {
    const rows = fixture();
    rows.push({
      id: "global-g43-dup",
      clinicId: null,
      doctorId: null,
      diagnosisCodePrefix: "G43",
      nameRu: "дубль",
      active: true,
    });
    const { db } = fakeDb(rows);

    const r = await seedGlobalProtocols(db, [G43], { apply: true });

    expect(r.duplicates).toEqual(["global-g43-dup"]);
    expect(rows.some((x) => x.id === "global-g43-dup")).toBe(true);
  });

  it("refuses curated data that repeats a prefix (the upsert key)", async () => {
    const { db, writes } = fakeDb(fixture());
    const twin: ProtocolSeed = { ...G43, nameRu: "другой" };
    await expect(seedGlobalProtocols(db, [G43, twin], { apply: true })).rejects.toThrow(/G43/);
    expect(writes).toEqual([]);
  });

  it("the curated bundle has one entry per prefix", () => {
    const prefixes = PROTOCOLS.map((p) => p.diagnosisCodePrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("the seed script has no delete and is a dry run by default", () => {
    const root = path.resolve(__dirname, "../../prisma");
    const script = readFileSync(path.join(root, "seed-protocols.ts"), "utf8");
    const helper = readFileSync(path.join(root, "_protocol-seed.ts"), "utf8");
    for (const src of [script, helper]) {
      expect(src).not.toMatch(/\.delete(Many)?\(/);
    }
    expect(script).toMatch(/seedGlobalProtocols\(prisma, PROTOCOLS, \{ apply: APPLY \}\)/);
    expect(script).toMatch(/const APPLY = process\.env\.APPLY === "1";/);
  });
});

describe("seed-handouts retires global handouts only (G2-05)", () => {
  it("the stale-row switch-off is scoped to clinicId null", () => {
    const src = readFileSync(path.resolve(__dirname, "../../prisma/seed-handouts.ts"), "utf8");
    const writes = src.match(/handoutTemplate\.(updateMany|deleteMany)\(\{[\s\S]*?\}\);/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/where: \{ clinicId: null, code: \{ notIn: codes \}, active: true \}/);
  });
});
