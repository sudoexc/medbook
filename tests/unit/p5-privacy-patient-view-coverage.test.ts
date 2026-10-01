/**
 * Audit G1-06: «Просмотры карточек» was written by three CRM routes only.
 * The doctor (the main reader of the chart), the file proxy, conclusions,
 * prints and exports were missing, and the throttle ignored which visit was
 * opened.
 *
 * Pinned: the route helper writes a row for a staff context with the IP and
 * agent, the throttle keys on contextRef, every chart-reading route calls
 * it with its context, a print's audit row names the patient, and bulk CSV
 * exports leave one audit row with the row count.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));

import { notePatientView } from "@/server/audit/patient-view";
import {
  PATIENT_VIEW_CONTEXTS,
  PATIENT_VIEW_CONTEXT_LABEL,
} from "@/lib/patient-view-contexts";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

function fakePrisma() {
  const rows: Array<Record<string, unknown>> = [];
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find(
      (r) =>
        r.viewerUserId === where.viewerUserId &&
        r.patientId === where.patientId &&
        r.context === where.context &&
        r.contextRef === where.contextRef,
    ) ?? null,
  );
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    rows.push(data);
    return data;
  });
  return { prisma: { patientView: { findFirst, create } } as never, rows, findFirst };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const doctorCtx = {
  kind: "TENANT" as const,
  clinicId: "c1",
  userId: "doc1",
  role: "DOCTOR" as const,
};
const request = new Request("https://neurofax.uz/x", {
  headers: { "x-real-ip": "10.1.1.1", "user-agent": "Chrome" },
});

describe("notePatientView", () => {
  it("writes the doctor's read with role, IP and agent", async () => {
    const { prisma, rows } = fakePrisma();
    notePatientView(prisma, request, doctorCtx, "p1", "doctor.card", "visits");
    await flush();
    expect(rows).toEqual([
      expect.objectContaining({
        clinicId: "c1",
        viewerUserId: "doc1",
        viewerRole: "DOCTOR",
        patientId: "p1",
        context: "doctor.card",
        contextRef: "visits",
        ip: "10.1.1.1",
        userAgent: "Chrome",
      }),
    ]);
  });

  it("two different visits in a row are two rows; the same one twice is one", async () => {
    const { prisma, rows, findFirst } = fakePrisma();
    notePatientView(prisma, request, doctorCtx, "p1", "visit_note", "vn1");
    await flush();
    notePatientView(prisma, request, doctorCtx, "p1", "visit_note", "vn2");
    await flush();
    notePatientView(prisma, request, doctorCtx, "p1", "visit_note", "vn1");
    await flush();
    expect(rows.map((r) => r.contextRef)).toEqual(["vn1", "vn2"]);
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({ contextRef: "vn1" });
  });

  it("writes nothing without a patient or for a non-staff context", async () => {
    const { prisma, rows } = fakePrisma();
    notePatientView(prisma, request, doctorCtx, null, "doctor.card");
    notePatientView(prisma, request, { kind: "SYSTEM" }, "p1", "doctor.card");
    await flush();
    expect(rows).toEqual([]);
  });
});

describe("every chart-reading route records the read", () => {
  const routes: Array<[string, string]> = [
    ["src/app/api/crm/doctors/me/patients/[patientId]/summary/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/visits/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/documents/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/labs/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/prescriptions/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/diagnoses/route.ts", '"doctor.card"'],
    ["src/app/api/crm/doctors/me/patients/[patientId]/visits/export/route.ts", '"export"'],
    ["src/app/api/crm/doctors/me/today/route.ts", '"doctor.current"'],
    ["src/app/api/crm/visit-notes/[id]/route.ts", '"visit_note"'],
    ["src/app/api/crm/visit-notes/[id]/previous/route.ts", '"visit_note"'],
    ["src/app/api/crm/visit-notes/[id]/print/route.ts", '"visit_note.print"'],
    ["src/app/api/crm/documents/[id]/route.ts", '"document.file"'],
    ["src/app/api/crm/documents/file/route.ts", '"document.file"'],
    ["src/app/api/crm/conversations/[id]/route.ts", '"conversation"'],
    ["src/app/[locale]/doctor/visits/[patientId]/[visitId]/page.tsx", '"doctor.visit"'],
  ];
  it.each(routes)("%s", (file, context) => {
    const src = read(file);
    expect(src).toContain("notePatientView(");
    expect(src).toContain(context);
  });

  it("the print's audit rows name the patient, so they are found under it", () => {
    const src = read("src/app/api/crm/visit-notes/[id]/print/route.ts");
    const rows = src.match(/action: "visit_note\.print"[\s\S]*?meta: \{[^}]*/g) ?? [];
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r).toContain("patientId: note.patient.id");
  });

  it("bulk CSV exports leave one audit row with the row count", () => {
    expect(read("src/server/workers/exports.ts")).toContain("AUDIT_ACTION.CRM_EXPORT_COMPLETED");
    expect(read("src/app/api/crm/patients/export/route.ts")).toContain(
      "AUDIT_ACTION.CRM_EXPORT_COMPLETED",
    );
  });

  it("every context has a label on the audit screen", () => {
    for (const c of PATIENT_VIEW_CONTEXTS) {
      expect(PATIENT_VIEW_CONTEXT_LABEL[c]).toMatch(/^context/);
    }
    const ru = JSON.parse(read("src/messages/ru.json"));
    const uz = JSON.parse(read("src/messages/uz.json"));
    for (const key of Object.values(PATIENT_VIEW_CONTEXT_LABEL)) {
      expect(ru.settings.audit.patientView[key], key).toBeTruthy();
      expect(uz.settings.audit.patientView[key], key).toBeTruthy();
    }
  });
});
