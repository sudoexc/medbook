/**
 * Audit G1-09: deleting a patient card checks everything attached to it.
 *
 * DELETE /api/crm/patients/[id] counted five tables. A card with an allergy,
 * a diagnosis, a course of medication or a DSAR request was deleted and the
 * cascade took those rows with it; a card that had received a broadcast
 * failed with a raw 500 on the restricting foreign key. The access log
 * («кто открывал карточку») was cascaded away too.
 *
 * Acceptance: a patient with an allergy or a broadcast and no visits gets
 * 409 with what is attached and nothing is deleted; a truly empty card is
 * deleted and its PatientView rows stay.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOOTPRINT_EXEMPT_RELATIONS,
  FOOTPRINT_RELATIONS,
  groupFootprint,
} from "@/lib/patients/footprint-groups";

const state = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  clinicalNotes: 0,
  exists: true,
  deleted: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  locked: [] as string[],
  deleteError: null as null | Error,
  views: [{ id: "pv1", patientId: "p1" }],
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "admin-1", role: "ADMIN" };
  return {
    createApiHandler:
      (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, body: undefined, ctx }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const patient = {
    findUnique: vi.fn(async (args: { select?: { _count?: unknown } }) => {
      if (!state.exists) return null;
      if (args.select?._count) {
        return { _count: { ...state.counts } };
      }
      return {
        id: "p1",
        clinicId: "c1",
        patientNumber: 42,
        fullName: "Каримова Дилноза",
        phone: "+998901112233",
        phoneNormalized: "+998901112233",
        passport: "AA1234567",
        notes: "перезвонить после 18:00",
        segment: "NEW",
        source: "TELEGRAM",
        createdAt: new Date("2026-09-01T00:00:00Z"),
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (state.deleteError) throw state.deleteError;
      state.deleted.push(where.id);
      // PatientView has no foreign key any more: its rows are untouched.
      return { id: where.id };
    }),
  };
  const tx = {
    patient,
    patientClinicalNote: { count: vi.fn(async () => state.clinicalNotes) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audits.push(data);
        return data;
      }),
    },
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, id: string) => {
      state.locked.push(id);
      return [{ id }];
    }),
  };
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});

const { DELETE } = await import("@/app/api/crm/patients/[id]/route");

function del() {
  return DELETE(new Request("https://x/api/crm/patients/p1", { method: "DELETE" }));
}

function zeroCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rel of FOOTPRINT_RELATIONS) {
    if (rel !== "clinicalNote") out[rel] = 0;
  }
  return out;
}

beforeEach(() => {
  state.counts = zeroCounts();
  state.clinicalNotes = 0;
  state.exists = true;
  state.deleted = [];
  state.audits = [];
  state.locked = [];
  state.deleteError = null;
});

describe("every relation of Patient is counted or exempt on purpose", () => {
  it("the footprint list matches prisma/schema.prisma", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const block = schema.slice(schema.indexOf("model Patient {"));
    const body = block.slice(block.indexOf("\n") + 1, block.indexOf("\n}"));
    const models = new Set(Array.from(schema.matchAll(/^model (\w+) \{/gm), (m) => m[1]));
    const relations = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/))
      .filter(([name, type]) => name && type && models.has(type.replace(/[[\]?]/g, "")))
      .map(([name]) => name)
      // The owning side (clinic) is not something the card carries.
      .filter((name) => name !== "clinic");
    const covered = new Set<string>([...FOOTPRINT_RELATIONS, ...FOOTPRINT_EXEMPT_RELATIONS]);
    expect(relations.filter((r) => !covered.has(r))).toEqual([]);
    expect([...covered].filter((r) => !relations.includes(r))).toEqual([]);
    // The access log is not a relation any more: it outlives the card.
    expect(relations).not.toContain("patientViews");
  });
});

describe("DELETE /api/crm/patients/[id]", () => {
  it("an allergy and no visits: 409 with the list, nothing deleted", async () => {
    state.counts.allergies = 1;
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("has_clinical_records");
    expect(body.counts).toEqual({ allergies: 1 });
    expect(state.deleted).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it("a broadcast the patient received: 409, not a 500", async () => {
    state.counts.notifications = 3;
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).counts).toEqual({ notifications: 3 });
  });

  it("a DSAR request, a diagnosis, a course of medication and the clinical note all count", async () => {
    state.counts.dataExportJobs = 1;
    state.counts.diagnoses = 2;
    state.counts.prescriptions = 1;
    state.clinicalNotes = 1;
    const res = await del();
    expect(res.status).toBe(409);
    const { counts } = await res.json();
    expect(counts).toEqual({
      dataExportJobs: 1,
      diagnoses: 2,
      prescriptions: 1,
      clinicalNote: 1,
    });
    expect(groupFootprint(counts)).toEqual([
      { group: "medical", count: 4 },
      { group: "dsar", count: 1 },
    ]);
  });

  it("a truly empty card is deleted under the row lock, its view log stays, the audit row has no identity", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(state.locked).toEqual(["p1"]);
    expect(state.deleted).toEqual(["p1"]);
    expect(state.views).toEqual([{ id: "pv1", patientId: "p1" }]);
    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0]!;
    expect(audit.action).toBe("patient.delete");
    expect(audit.actorId).toBe("admin-1");
    const meta = JSON.stringify(audit.meta);
    expect(meta).not.toContain("Каримова");
    expect(meta).not.toContain("AA1234567");
    expect(meta).not.toContain("+998901112233");
    expect(meta).not.toContain("перезвонить");
    expect(audit.meta).toMatchObject({ card: { patientNumber: 42 } });
  });

  it("a row that slipped in after the count: Postgres refuses, the answer is still 409", async () => {
    state.deleteError = Object.assign(new Error("Foreign key constraint violated"), {
      code: "P2003",
    });
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("has_clinical_records");
  });
});
