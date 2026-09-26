import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_PATIENT_DELETE_ORDER,
  deleteDemoPatients,
  demoDeleteWhere,
} from "../../scripts/_demo-clean";

/**
 * Audit G2-07: seed-demo-data's CLEAN stopped halfway on RESTRICT links and
 * left the clinic half cleaned; the seed itself booked in UTC and made WALKIN
 * «bookings». CLEAN now removes every demo row or nothing, child rows first.
 */

const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");

type Relation = { model: string; target: string; optional: boolean; onDelete: string | null };

function relationsTo(target: string): Relation[] {
  const out: Relation[] = [];
  let model = "";
  for (const line of schema.split("\n")) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) {
      model = m[1]!;
      continue;
    }
    const r = new RegExp(`^\\s+\\w+\\s+${target}(\\?)?\\s+@relation\\((.*)\\)`).exec(line);
    if (!r || !model) continue;
    const onDelete = /onDelete:\s*(\w+)/.exec(r[2]!)?.[1] ?? null;
    out.push({ model, target, optional: r[1] === "?", onDelete });
  }
  return out;
}

const delegate = (model: string) => model[0]!.toLowerCase() + model.slice(1);
const pos = (d: string) => (DEMO_PATIENT_DELETE_ORDER as readonly string[]).indexOf(d);

describe("DEMO_PATIENT_DELETE_ORDER against the schema", () => {
  it("deletes every row that would block deleting a patient before the patient", () => {
    // Required relations default to Restrict; explicit Restrict/NoAction too.
    const blocking = relationsTo("Patient").filter(
      (r) =>
        (!r.optional && r.onDelete === null) ||
        r.onDelete === "Restrict" ||
        r.onDelete === "NoAction",
    );
    expect(blocking.map((r) => r.model)).toEqual(
      expect.arrayContaining(["VisitNote", "Document", "Appointment", "MedicalCase", "EPrescription"]),
    );
    for (const r of blocking) {
      expect(pos(delegate(r.model)), `${r.model} before Patient`).toBeGreaterThanOrEqual(0);
      expect(pos(delegate(r.model)), `${r.model} before Patient`).toBeLessThan(pos("patient"));
    }
  });

  // Optional links fall back to SetNull: the row would survive with no
  // patient or visit (a PAID payment still counted in revenue, a lab result
  // with no visit). Site requests are the exception on purpose: a real lead
  // stays even if it was linked to a demo card.
  const KEEP = new Set(["Lead", "OnlineRequest"]);
  it.each(["Patient", "Appointment", "VisitNote"])(
    "deletes every non-cascade child of %s before it instead of orphaning it",
    (target) => {
      const children = relationsTo(target).filter(
        (r) => r.model !== target && r.onDelete !== "Cascade" && !KEEP.has(r.model),
      );
      expect(children.length).toBeGreaterThan(0);
      for (const r of children) {
        const d = delegate(r.model);
        expect(pos(d), `${r.model} → ${target}`).toBeGreaterThanOrEqual(0);
        expect(pos(d), `${r.model} before ${target}`).toBeLessThan(pos(delegate(target)));
      }
    },
  );

  it("ends with appointments, cases and the patients themselves", () => {
    expect(DEMO_PATIENT_DELETE_ORDER.slice(-3)).toEqual(["appointment", "medicalCase", "patient"]);
  });
});

describe("deleteDemoPatients", () => {
  it("deletes in order, scoped to the demo patients and their appointments", async () => {
    const calls: Array<{ model: string; where: Record<string, unknown> }> = [];
    const tx = Object.fromEntries(
      DEMO_PATIENT_DELETE_ORDER.map((m) => [
        m,
        {
          deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
            calls.push({ model: m, where });
            return { count: 1 };
          },
        },
      ]),
    ) as Record<string, unknown>;
    (tx.appointment as Record<string, unknown>).findMany = async () => [{ id: "a1" }, { id: "a2" }];

    const out = await deleteDemoPatients(tx as never, ["p1"]);
    expect(calls.map((c) => c.model)).toEqual([...DEMO_PATIENT_DELETE_ORDER]);
    expect(out.patient).toBe(1);
    expect(calls.find((c) => c.model === "payment")!.where).toEqual({
      OR: [{ patientId: { in: ["p1"] } }, { appointmentId: { in: ["a1", "a2"] } }],
    });
    expect(calls.find((c) => c.model === "appointment")!.where).toEqual({
      id: { in: ["a1", "a2"] },
    });
    expect(calls.find((c) => c.model === "patient")!.where).toEqual({ id: { in: ["p1"] } });
  });

  it("does nothing without patients", async () => {
    await expect(deleteDemoPatients({} as never, [])).resolves.toEqual({});
  });

  it("builds patient-only filters for rows with no appointment link", () => {
    expect(demoDeleteWhere("medicalCase", ["p1"], ["a1"])).toEqual({ patientId: { in: ["p1"] } });
  });
});

describe("seed-demo-data itself", () => {
  const src = readFileSync(path.resolve(__dirname, "../../scripts/seed-demo-data.ts"), "utf8");

  it("runs CLEAN in one transaction through deleteDemoPatients", () => {
    expect(src).toMatch(/if \(CLEAN\) \{[\s\S]*prisma\.\$transaction\([\s\S]*deleteDemoPatients\(tx, patientIds\)/);
  });

  it("builds times in Tashkent, not with the container clock", () => {
    expect(src).not.toMatch(/\.setHours\(/);
    expect(src).not.toMatch(/\.setMinutes\(/);
    expect(src).not.toMatch(/getHours\(\)/);
    expect(src).not.toMatch(/new Date\(\)\.getDay\(\)/);
    expect(src).toMatch(/toTashkentDate\(/);
  });

  it("never books a future visit on the WALKIN channel", () => {
    expect(src).not.toMatch(/pick\(\["WALKIN", "PHONE", "TELEGRAM"\]/);
    expect(src).toMatch(/channel: pick\(DEMO_CHANNELS/);
  });

  it("marks demo patients and payments so the app can tell them apart", () => {
    expect(src).toMatch(/tags: \[TAG, DEMO_SEED_MARK/);
    expect(src.match(/externalRef: DEMO_SEED_MARK/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("never attaches demo rows to a card that is not its own", () => {
    expect(src).toMatch(/if \(existing && !existing\.tags\.includes\(TAG\)\) continue;/);
  });
});
