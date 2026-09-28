/**
 * Audit G3-02 — an allergy a nurse records while the doctor has the visit
 * open never reached the doctor's drug check: the routes wrote and audited
 * but announced nothing, and the check's query key only holds the
 * prescriptions, so the green «Конфликтов не найдено» stayed up.
 *
 * Pinned:
 *   1. Every allergy / diagnosis / chronic-condition write publishes
 *      `patient.medicalRecordChanged` through the outbox, inside the same
 *      transaction as the write, scoped to the patient.
 *   2. The event is a valid, staff-only event (never sent to the Mini App).
 *   3. The doctor's drug check listens to it (and to course / questionnaire
 *      changes) and its every query key starts with the patient's prefix,
 *      which is what the listener invalidates; the CRM medical tab listens
 *      too; signing re-runs the check.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppEventSchema } from "@/server/realtime/events";
import { MINIAPP_DELIVERABLE_TYPES } from "@/app/api/miniapp/events/route";
import {
  CDS_STALE_EVENTS,
  cdsDrugCheckKey,
  cdsDrugCheckPatientKey,
} from "@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  role: "NURSE" as string,
  published: [] as Array<{ tx: unknown; envelope: Row }>,
  inTx: false,
  writes: [] as Array<{ model: string; op: string; inTx: boolean }>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_1", role: h.role, clinicId: "c1", email: "n@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT" as const, clinicId: "c1", userId: "u_1", role: h.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async (tx: unknown, envelope: Row) => {
    h.published.push({ tx, envelope });
    return { eventId: "ev_1", correlationId: "corr_test" };
  }),
}));

vi.mock("@/lib/prisma", () => {
  const model = (name: string, row: Row) => {
    const record = (op: string) => async () => {
      h.writes.push({ model: name, op, inTx: h.inTx });
      return row;
    };
    return {
      findUnique: vi.fn(async () => row),
      create: vi.fn(record("create")),
      update: vi.fn(record("update")),
      delete: vi.fn(record("delete")),
    };
  };
  const prisma = {
    patient: { findUnique: vi.fn(async () => ({ id: "p1", clinicId: "c1" })) },
    patientAllergy: model("patientAllergy", {
      id: "al_1",
      clinicId: "c1",
      patientId: "p1",
      substance: "Пенициллин",
      severity: "SEVERE",
    }),
    patientDiagnosis: model("patientDiagnosis", {
      id: "dx_1",
      clinicId: "c1",
      patientId: "p1",
      label: "Мигрень",
      icd10Code: "G43.0",
    }),
    patientChronicCondition: model("patientChronicCondition", {
      id: "ch_1",
      clinicId: "c1",
      patientId: "p1",
      name: "Эпилепсия",
    }),
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
      h.inTx = true;
      try {
        return await fn(prisma);
      } finally {
        h.inTx = false;
      }
    }),
  };
  return { prisma };
});

const json = (url: string, method: string, body?: unknown) =>
  new Request(`https://x${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.role = "NURSE";
  h.published = [];
  h.writes = [];
});

function lastEvent() {
  expect(h.published).toHaveLength(1);
  return h.published[0]!.envelope as {
    type: string;
    surface: string;
    actor: { role: string };
    tenantScope: { clinicId: string; patientId?: string };
    payload: Row;
  };
}

describe("writes announce themselves, in the same transaction", () => {
  it("a nurse records an allergy (acceptance: the doctor's check must hear it)", async () => {
    const { POST } = await import("@/app/api/crm/patients/[id]/allergies/route");
    const res = await POST(
      json("/api/crm/patients/p1/allergies", "POST", {
        substance: "Пенициллин",
        severity: "SEVERE",
      }),
    );
    expect(res.status).toBe(201);
    const e = lastEvent();
    expect(e.type).toBe("patient.medicalRecordChanged");
    expect(e.tenantScope).toEqual({ clinicId: "c1", patientId: "p1" });
    expect(e.payload).toEqual({
      patientId: "p1",
      record: "allergy",
      action: "created",
      entityId: "al_1",
    });
    expect(e.surface).toBe("CRM");
    // Written and announced inside one transaction.
    expect(h.writes).toEqual([{ model: "patientAllergy", op: "create", inTx: true }]);
  });

  it("removing the allergy is announced too", async () => {
    const { DELETE } = await import(
      "@/app/api/crm/patients/[id]/allergies/[allergyId]/route"
    );
    await DELETE(json("/api/crm/patients/p1/allergies/al_1", "DELETE"));
    expect(lastEvent().payload).toMatchObject({ record: "allergy", action: "deleted" });
  });

  it("an allergy edited by the doctor from the visit comes from the cabinet", async () => {
    h.role = "DOCTOR";
    const { PATCH } = await import(
      "@/app/api/crm/patients/[id]/allergies/[allergyId]/route"
    );
    await PATCH(json("/api/crm/patients/p1/allergies/al_1", "PATCH", { severity: "MODERATE" }));
    const e = lastEvent();
    expect(e.payload).toMatchObject({ record: "allergy", action: "updated" });
    expect(e.surface).toBe("DOCTOR_CABINET");
    expect(e.actor.role).toBe("DOCTOR");
  });

  it("diagnoses and chronic conditions announce the same way", async () => {
    const dx = await import("@/app/api/crm/patients/[id]/diagnoses/route");
    await dx.POST(json("/api/crm/patients/p1/diagnoses", "POST", { label: "Мигрень", icd10Code: "G43.0" }));
    expect(lastEvent().payload).toMatchObject({ record: "diagnosis", action: "created" });

    h.published = [];
    const dxOne = await import("@/app/api/crm/patients/[id]/diagnoses/[diagnosisId]/route");
    await dxOne.PATCH(json("/api/crm/patients/p1/diagnoses/dx_1", "PATCH", { status: "RESOLVED" }));
    expect(lastEvent().payload).toMatchObject({ record: "diagnosis", action: "updated" });

    h.published = [];
    await dxOne.DELETE(json("/api/crm/patients/p1/diagnoses/dx_1", "DELETE"));
    expect(lastEvent().payload).toMatchObject({ record: "diagnosis", action: "deleted" });

    h.published = [];
    const ch = await import("@/app/api/crm/patients/[id]/chronic-conditions/route");
    await ch.POST(json("/api/crm/patients/p1/chronic-conditions", "POST", { name: "Эпилепсия" }));
    expect(lastEvent().payload).toMatchObject({ record: "chronic", action: "created" });

    h.published = [];
    const chOne = await import(
      "@/app/api/crm/patients/[id]/chronic-conditions/[conditionId]/route"
    );
    await chOne.PATCH(json("/api/crm/patients/p1/chronic-conditions/ch_1", "PATCH", { isActive: false }));
    expect(lastEvent().payload).toMatchObject({ record: "chronic", action: "updated" });

    h.published = [];
    await chOne.DELETE(json("/api/crm/patients/p1/chronic-conditions/ch_1", "DELETE"));
    expect(lastEvent().payload).toMatchObject({ record: "chronic", action: "deleted" });
  });
});

describe("the event", () => {
  it("is a valid realtime event and stays off the Mini App", () => {
    const ok = AppEventSchema.safeParse({
      type: "patient.medicalRecordChanged",
      clinicId: "c1",
      at: "2026-09-28T09:00:00.000Z",
      payload: { patientId: "p1", record: "allergy", action: "created" },
    });
    expect(ok.success).toBe(true);
    expect(MINIAPP_DELIVERABLE_TYPES.has("patient.medicalRecordChanged")).toBe(false);
  });
});

describe("the listeners", () => {
  it("the drug check refetches on record, course and questionnaire changes", () => {
    expect(CDS_STALE_EVENTS).toEqual(
      expect.arrayContaining([
        "patient.medicalRecordChanged",
        "prescription.created",
        "prescription.updated",
        "previsit.submitted",
      ]),
    );
  });

  it("every check key starts with the patient prefix the listener invalidates", () => {
    const prefix = cdsDrugCheckPatientKey("p1");
    const key = cdsDrugCheckKey({
      patientId: "p1",
      prescriptions: ["Амоксициллин 500 мг"],
      drugRows: [{ id: "amoxicillin", displayName: "Амоксициллин" }],
      diagnosisCode: "J02.9",
    });
    expect(key.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it("the CRM medical tab listens for each of its three lists", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/crm/patients/[id]/_hooks/use-patient-medical.ts",
      ),
      "utf8",
    );
    expect(src).toContain('"patient.medicalRecordChanged"');
    for (const [record, key] of [
      ["allergy", "allergies"],
      ["chronic", "chronic"],
      ["diagnosis", "diagnoses"],
    ]) {
      expect(src).toContain(
        `useMedicalRecordLive(patientId, "${record}", ["patient", patientId, "${key}"])`,
      );
    }
  });

  it("signing re-runs the drug check", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/doctor/reception/_components/visit-action-bar.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("cdsDrugCheckPatientKey(appointment.patient.id)");
  });
});
