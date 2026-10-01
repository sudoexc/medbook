/**
 * Audit G1-07: an edit of an allergy, a card diagnosis or a chronic
 * condition was audited as the names of the changed fields, and a delete as
 * the substance / label / name only. After «пенициллин, анафилаксия
 * (SEVERE)» was changed to MILD or removed, nobody could say what the
 * record had said.
 *
 * Acceptance: change an allergy's severity, then delete it: the audit log
 * holds the old and the new severity, and the whole removed row
 * (substance, reaction, severity, notes, recordedAt).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  audits: [] as Array<{ action: string; entityId?: string | null; meta?: unknown }>,
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "NURSE" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body:
            opts.bodySchema && request.method !== "DELETE"
              ? opts.bodySchema.parse(await request.json())
              : undefined,
          ctx,
        }),
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: { action: string; meta?: unknown }) => {
    state.audits.push(input);
  }),
}));
vi.mock("@/server/patient/medical-record-events", () => ({
  publishMedicalRecordChanged: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => {
  const model = () => ({
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.rows.get(where.id) ? { ...state.rows.get(where.id)! } : null,
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = { ...state.rows.get(where.id)!, ...data, updatedAt: new Date() };
        state.rows.set(where.id, next);
        return next;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.rows.delete(where.id);
      return {};
    }),
  });
  const prisma = {
    patientAllergy: model(),
    patientDiagnosis: model(),
    patientChronicCondition: model(),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import {
  DELETE as deleteAllergy,
  PATCH as patchAllergy,
} from "@/app/api/crm/patients/[id]/allergies/[allergyId]/route";
import {
  DELETE as deleteDiagnosis,
  PATCH as patchDiagnosis,
} from "@/app/api/crm/patients/[id]/diagnoses/[diagnosisId]/route";
import {
  DELETE as deleteChronic,
  PATCH as patchChronic,
} from "@/app/api/crm/patients/[id]/chronic-conditions/[conditionId]/route";

const recordedAt = new Date("2025-03-01T00:00:00Z");

beforeEach(() => {
  state.audits = [];
  state.rows.clear();
  state.rows.set("al1", {
    id: "al1",
    clinicId: "c1",
    patientId: "p1",
    substance: "Пенициллин",
    reaction: "анафилаксия",
    severity: "SEVERE",
    notes: "реанимация в 2019",
    recordedAt,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });
  state.rows.set("dx1", {
    id: "dx1",
    clinicId: "c1",
    patientId: "p1",
    icd10Code: "G43.0",
    label: "Мигрень без ауры",
    status: "ACTIVE",
    notes: null,
    updatedAt: recordedAt,
  });
  state.rows.set("cc1", {
    id: "cc1",
    clinicId: "c1",
    patientId: "p1",
    name: "Гипертония",
    isActive: true,
    notes: "с 2015",
    updatedAt: recordedAt,
  });
});

const call = (
  method: "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) =>
  new Request(`https://neurofax.uz/api/crm/patients/p1/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("allergy edits and deletes keep what the record said", () => {
  it("a severity change records the old and the new value", async () => {
    const res = await patchAllergy(call("PATCH", "allergies/al1", { severity: "MILD" }));
    expect(res.status).toBe(200);
    const row = state.audits.find((a) => a.action === "patient.allergy.update")!;
    expect(row.meta).toMatchObject({
      patientId: "p1",
      changed: ["severity"],
      before: { severity: "SEVERE" },
      after: { severity: "MILD" },
    });
  });

  it("a delete records the whole removed row", async () => {
    const res = await deleteAllergy(call("DELETE", "allergies/al1"));
    expect(res.status).toBe(200);
    const row = state.audits.find((a) => a.action === "patient.allergy.delete")!;
    expect(row.meta).toMatchObject({
      patientId: "p1",
      deleted: {
        substance: "Пенициллин",
        reaction: "анафилаксия",
        severity: "SEVERE",
        notes: "реанимация в 2019",
        recordedAt,
      },
    });
  });
});

describe("card diagnoses and chronic conditions the same way", () => {
  it("diagnosis: old and new status, and the deleted row", async () => {
    await patchDiagnosis(call("PATCH", "diagnoses/dx1", { status: "RESOLVED" }));
    await deleteDiagnosis(call("DELETE", "diagnoses/dx1"));
    expect(state.audits.find((a) => a.action === "patient.diagnosis.update")!.meta).toMatchObject({
      before: { status: "ACTIVE" },
      after: { status: "RESOLVED" },
    });
    expect(state.audits.find((a) => a.action === "patient.diagnosis.delete")!.meta).toMatchObject({
      deleted: { icd10Code: "G43.0", label: "Мигрень без ауры", status: "RESOLVED" },
    });
  });

  it("chronic condition: old and new value, and the deleted row", async () => {
    await patchChronic(call("PATCH", "chronic-conditions/cc1", { isActive: false }));
    await deleteChronic(call("DELETE", "chronic-conditions/cc1"));
    expect(state.audits.find((a) => a.action === "patient.chronic.update")!.meta).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });
    expect(state.audits.find((a) => a.action === "patient.chronic.delete")!.meta).toMatchObject({
      deleted: { name: "Гипертония", notes: "с 2015" },
    });
  });
});
