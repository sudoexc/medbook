/**
 * Audit CD-07: e-prescriptions, sick leave, lab orders and referrals had no
 * entry point since 15.07 (1622b12), yet the backend kept accepting new
 * forms, the referral PDF worker kept polling, the doctor's «Подпись»
 * setting promised a signature that appeared nowhere, and a form issued
 * earlier could not be found, reprinted or cancelled.
 *
 * Decision (docs/api/clinical-forms.md): issuing is switched off; the forms
 * issued earlier get a register in the patient card with reprint and
 * cancel, and their QR check keeps answering.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLINICAL_FORMS_ISSUING } from "@/lib/clinical-forms-issuing";
import {
  issuedFormPrintHref,
  mergeIssuedForms,
} from "@/app/[locale]/crm/patients/[id]/_hooks/use-issued-forms";

const h = vi.hoisted(() => ({
  role: "DOCTOR",
  writes: 0,
  listArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: h.role, clinicId: "c1", email: "u@x.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: h.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => {
    h.writes += 1;
  }),
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const write = vi.fn(async () => {
    h.writes += 1;
    return { id: "x" };
  });
  const list = vi.fn(async (args: Record<string, unknown>) => {
    h.listArgs.push(args);
    return [
      {
        id: "rx1",
        rxNumber: "RX-20260601-0001",
        certNumber: "SL-20260601-0001",
        clinicId: "c1",
        patientId: "p1",
        doctorId: "u_doc",
        appointmentId: null,
        visitNoteId: null,
        diagnosisCode: null,
        diagnosisName: null,
        items: [],
        notes: null,
        regimen: "OUTPATIENT",
        periodFrom: new Date("2026-06-01T00:00:00Z"),
        periodTo: new Date("2026-06-05T00:00:00Z"),
        restrictions: null,
        issuedAt: new Date("2026-06-01T06:00:00Z"),
        validUntilAt: new Date("2026-07-01T06:00:00Z"),
        printedAt: null,
        status: "ISSUED",
        cancelledAt: null,
        cancelReason: null,
        createdAt: new Date("2026-06-01T06:00:00Z"),
        doctor: { name: "Султанов Азиз" },
      },
    ];
  });
  const model = { create: write, findMany: list, count: vi.fn(async () => 0) };
  return {
    prisma: {
      ePrescription: model,
      sickLeave: model,
      labOrder: model,
      referral: model,
      doctor: { findFirst: vi.fn(async () => ({ id: "doc1", signatureUrl: null })) },
      patient: { findFirst: vi.fn(async () => ({ id: "p1" })) },
      appointment: { findFirst: vi.fn(async () => ({ id: "a1" })) },
      user: { findFirst: vi.fn(async () => ({ id: "u2" })) },
      labCatalog: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ ePrescription: model, sickLeave: model, referral: model, labOrder: model })),
    },
  };
});

import { GET as listRx, POST as createRx } from "@/app/api/crm/e-prescriptions/route";
import { GET as listSl, POST as createSl } from "@/app/api/crm/sick-leaves/route";
import { POST as createLab } from "@/app/api/crm/lab-orders/route";
import { POST as createReferral } from "@/app/api/crm/referrals/route";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.role = "DOCTOR";
  h.writes = 0;
  h.listArgs = [];
});

describe("issuing is switched off (CD-07)", () => {
  it("the switch is off", () => {
    expect(CLINICAL_FORMS_ISSUING).toBe(false);
  });

  it("every create route answers 410 form_retired and writes nothing", async () => {
    const cases: Array<[string, Promise<Response>]> = [
      [
        "e-prescription",
        createRx(
          post("https://x/api/crm/e-prescriptions", {
            patientId: "p1",
            items: [{ drugName: "Мидокалм", dose: "150 мг", frequency: "2 раза" }],
          }),
        ),
      ],
      [
        "sick-leave",
        createSl(
          post("https://x/api/crm/sick-leaves", {
            patientId: "p1",
            periodFrom: "2026-10-01",
            periodTo: "2026-10-05",
          }),
        ),
      ],
      [
        "lab-order",
        createLab(post("https://x/api/crm/lab-orders", { patientId: "p1", testCodes: ["CBC"] })),
      ],
      [
        "referral",
        createReferral(
          post("https://x/api/crm/referrals", {
            patientId: "p1",
            reason: "консультация",
            externalTo: "Кардиоцентр",
          }),
        ),
      ],
    ];
    for (const [form, pending] of cases) {
      const res = await pending;
      expect(res.status, form).toBe(410);
      expect(await res.json(), form).toMatchObject({ reason: "form_retired", form });
    }
    expect(h.writes).toBe(0);
  });

  it("the referral PDF worker is not started and the signature tab is hidden", () => {
    const start = read("src/server/workers/start.ts");
    expect(start).toMatch(
      /const referralDocument = CLINICAL_FORMS_ISSUING\s*\?\s*startReferralDocumentWorker\(\)\s*:\s*null;/,
    );
    const tabs = read("src/app/[locale]/doctor/settings/_components/settings-tabs.tsx");
    expect(tabs).toContain("const SIGNATURE_TAB = CLINICAL_FORMS_ISSUING;");
    expect(tabs).toContain('tab === "signature" && SIGNATURE_TAB');
  });

  it("the unmounted dialogs are gone", () => {
    for (const f of [
      "e-prescription-dialog.tsx",
      "sick-leave-dialog.tsx",
      "lab-order-dialog.tsx",
      "referral-dialog.tsx",
    ]) {
      expect(existsSync(path.join(root, "src/app/[locale]/doctor/reception/_components", f)), f).toBe(false);
    }
  });
});

describe("forms issued earlier stay usable (CD-07)", () => {
  it("ADMIN lists a patient's prescriptions and sick leaves with the issuer's name", async () => {
    h.role = "ADMIN";
    const rx = await listRx(new Request("https://x/api/crm/e-prescriptions?patientId=p1&limit=100"));
    expect(rx.status).toBe(200);
    const rxBody = (await rx.json()) as { rows: Array<Record<string, unknown>> };
    expect(rxBody.rows[0]).toMatchObject({ rxNumber: "RX-20260601-0001", doctorName: "Султанов Азиз" });

    const sl = await listSl(new Request("https://x/api/crm/sick-leaves?patientId=p1&limit=100"));
    const slBody = (await sl.json()) as { rows: Array<Record<string, unknown>> };
    expect(slBody.rows[0]).toMatchObject({
      certNumber: "SL-20260601-0001",
      periodFrom: "2026-06-01",
      doctorName: "Султанов Азиз",
    });
    expect(h.listArgs[0]).toMatchObject({
      where: { clinicId: "c1", patientId: "p1" },
      include: { doctor: { select: { name: true } } },
    });
  });

  it("the register merges both kinds newest first and prints through the existing routes", () => {
    const merged = mergeIssuedForms(
      [
        {
          id: "rx1",
          rxNumber: "RX-1",
          issuedAt: "2026-06-01T06:00:00.000Z",
          validUntilAt: "2026-07-01T06:00:00.000Z",
          status: "ISSUED",
          cancelReason: null,
          doctorName: "Султанов Азиз",
        },
      ],
      [
        {
          id: "sl1",
          certNumber: "SL-1",
          issuedAt: "2026-06-10T06:00:00.000Z",
          periodFrom: "2026-06-10",
          periodTo: "2026-06-14",
          status: "CANCELLED",
          cancelReason: "ошибка в датах",
        },
      ],
      new Date("2026-06-15T00:00:00Z"),
    );
    expect(merged.map((f) => `${f.kind}:${f.number}:${f.status}`)).toEqual([
      "sl:SL-1:CANCELLED",
      "rx:RX-1:ISSUED",
    ]);
    // Read at fetch time, not during render.
    expect(merged[1]!.expired).toBe(false);
    expect(
      mergeIssuedForms(
        [
          {
            id: "rx1",
            rxNumber: "RX-1",
            issuedAt: "2026-06-01T06:00:00.000Z",
            validUntilAt: "2026-07-01T06:00:00.000Z",
            status: "ISSUED",
            cancelReason: null,
          },
        ],
        [],
        new Date("2026-08-01T00:00:00Z"),
      )[0]!.expired,
    ).toBe(true);
    expect(issuedFormPrintHref(merged[0]!)).toBe("/api/crm/sick-leaves/sl1/print");
    expect(issuedFormPrintHref(merged[1]!)).toBe("/api/crm/e-prescriptions/rx1/print");
  });

  it("the public check shows a cancelled sick leave as «АННУЛИРОВАН»", () => {
    expect(read("src/app/api/verify/sick-leave/[token]/route.ts")).toContain('"АННУЛИРОВАН"');
  });
});
