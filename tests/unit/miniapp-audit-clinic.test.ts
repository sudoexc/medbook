/**
 * Audit G1-03: every audit row from the Mini App was written with
 * `clinicId = NULL` and no actor, so the clinic administrator never saw a
 * patient's deletion or export request, upload, message or consent change
 * (the journal filters by clinicId), and the platform saw them as «system».
 *
 * Acceptance: a patient requests a data export in the Mini App; the clinic's
 * journal gets PATIENT_DATA_EXPORT_REQUESTED with the clinic's id and the
 * actor patient:<id>. No Mini App route writes through `audit()` any more.
 * Old rows are repaired by scripts/fix-g1-03-miniapp-audit-clinic.ts, whose
 * rules are pinned here too.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  authCalls: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => {
    h.authCalls += 1;
    // A staff cookie in the same browser must not sign a patient's action.
    return { user: { id: "staff_1", clinicId: "c_other", role: "ADMIN", email: "admin@x" } };
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.rows.push(data);
        return data;
      }),
    },
    dataExportJob: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "job_1", status: "PENDING" })),
    },
  },
}));
vi.mock("@/server/workers/data-export", () => ({ enqueueExportJob: vi.fn(async () => undefined) }));
vi.mock("@/server/miniapp/handler", () => ({
  createMiniAppHandler:
    (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
    (request: Request) =>
      handler({
        request,
        body: {},
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "p_42",
          patient: { telegramId: "777", preferredLang: "RU" },
        },
      }),
}));

import { auditMiniApp } from "@/lib/audit";
import {
  MINIAPP_AUDIT_ACTIONS,
  planMiniAppAuditFix,
  type OrphanAuditRow,
} from "@/server/audit/miniapp-audit-backfill";

beforeEach(() => {
  h.rows = [];
  h.authCalls = 0;
});

describe("auditMiniApp", () => {
  it("writes the clinic and the Telegram patient, never the browser's staff session", async () => {
    await auditMiniApp(
      new Request("https://neurofax.uz/api/miniapp/x", { headers: { "user-agent": "TG" } }),
      { clinicId: "c1", patientId: "p_42" },
      { action: "MINIAPP_MESSAGE_SENT", entityType: "Message", entityId: "m1", meta: { bytes: 3 } },
    );
    expect(h.rows[0]).toMatchObject({
      clinicId: "c1",
      action: "MINIAPP_MESSAGE_SENT",
      entityType: "Message",
      entityId: "m1",
      actorId: null,
      actorRole: "PATIENT",
      actorLabel: "patient:p_42",
      surface: "MINIAPP",
      userAgent: "TG",
    });
    expect(h.authCalls).toBe(0);
  });
});

describe("acceptance: a data export requested in the Mini App", () => {
  it("lands in the clinic's journal with the patient as actor", async () => {
    const { POST } = await import("@/app/api/miniapp/account/export/route");
    const res = await POST(new Request("https://neurofax.uz/api/miniapp/account/export", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      clinicId: "c1",
      action: "PATIENT_DATA_EXPORT_REQUESTED",
      entityId: "job_1",
      actorRole: "PATIENT",
      actorLabel: "patient:p_42",
    });
  });
});

describe("no Mini App route writes through audit()", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  }

  it("every audit call under /api/miniapp is auditMiniApp", () => {
    const root = path.join(process.cwd(), "src/app/api/miniapp");
    const offenders = files(root).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /import\s*\{[^}]*\baudit\b[^}]*\}\s*from\s*"@\/lib\/audit"/.test(src) || /\bawait audit\(/.test(src);
    });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});

describe("repairing the old rows", () => {
  const clinics = new Set(["c1", "c2"]);
  const patients = new Map([
    ["p_42", "c1"],
    ["p_mom", "c2"],
  ]);
  const row = (over: Partial<OrphanAuditRow>): OrphanAuditRow => ({
    id: "a1",
    action: "PATIENT_DATA_EXPORT_REQUESTED",
    entityType: "DataExportJob",
    entityId: "job_1",
    meta: { patientId: "p_42", requestedBy: "patient" },
    actorLabel: null,
    surface: null,
    ...over,
  });

  it("covers every Mini App action that went through audit()", () => {
    expect([...MINIAPP_AUDIT_ACTIONS].sort()).toEqual(
      [
        "LOW_NPS_RECEIVED",
        "MARKETING_OPT_OUT_CHANGED",
        "MEDICATION_REMINDER_RESPONDED",
        "MINIAPP_DOCUMENT_UPLOADED",
        "MINIAPP_MESSAGE_SENT",
        "PATIENT_DATA_EXPORT_REQUESTED",
        "PATIENT_DELETION_APPROVED",
        "PATIENT_DELETION_CANCELLED",
        "PATIENT_DELETION_REQUESTED",
      ].sort(),
    );
  });

  it("clinic from the patient, actor from the row", () => {
    expect(planMiniAppAuditFix(row({}), clinics, patients)).toEqual({
      id: "a1",
      clinicId: "c1",
      actor: { role: "PATIENT", label: "patient:p_42" },
      surface: "MINIAPP",
    });
  });

  it("meta.clinicId wins when it names a real clinic; a bogus one falls back to the patient", () => {
    const upload = row({
      action: "MINIAPP_DOCUMENT_UPLOADED",
      meta: { clinicId: "c2", patientId: "p_mom", actorPatientId: "p_42" },
    });
    expect(planMiniAppAuditFix(upload, clinics, patients)).toMatchObject({
      clinicId: "c2",
      // The owner who uploaded for his mother.
      actor: { label: "patient:p_42" },
    });
    expect(
      planMiniAppAuditFix(row({ meta: { clinicId: "nope", patientId: "p_42" } }), clinics, patients)?.clinicId,
    ).toBe("c1");
  });

  it("the profile's opt-out row is about its own patient", () => {
    const optOut = row({
      action: "MARKETING_OPT_OUT_CHANGED",
      entityType: "Patient",
      entityId: "p_42",
      meta: { source: "mini-app", optedOut: true },
    });
    expect(planMiniAppAuditFix(optOut, clinics, patients)).toMatchObject({
      clinicId: "c1",
      actor: { label: "patient:p_42" },
    });
  });

  it("a row written for a relative gets its clinic but no invented actor", () => {
    const forMom = row({
      action: "MEDICATION_REMINDER_RESPONDED",
      entityType: "MedicationReminderSend",
      meta: { patientId: "p_mom", onBehalfOfPatientId: "p_mom" },
    });
    expect(planMiniAppAuditFix(forMom, clinics, patients)).toMatchObject({ clinicId: "c2", actor: null });
  });

  it("an existing actor or surface is kept; an unknown clinic leaves the row alone", () => {
    expect(
      planMiniAppAuditFix(row({ actorLabel: "patient:p_x", surface: "MINIAPP" }), clinics, patients),
    ).toMatchObject({ actor: null, surface: null });
    expect(planMiniAppAuditFix(row({ meta: { patientId: "p_deleted" } }), clinics, patients)).toBeNull();
  });
});
