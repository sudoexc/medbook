/**
 * Audit DC-03: «Экспорт CSV» of a patient's visit history answered 500 for
 * nearly every patient. The Cyrillic name went into a bare
 * `filename="visits-Иванов…"`, which the Response constructor refuses (header
 * values are ByteStrings), and the audit row «exported» was written before
 * the crash. Also: quoting a cell does not stop Excel from running a formula.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audits: [] as Array<{ action: string; meta: unknown }>,
  patientName: "Иванов Иван Иванович",
  diagnosisName: "Мигрень без ауры",
  failHeader: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc", role: "DOCTOR", clinicId: "c1", email: "d@x.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_doc", role: "DOCTOR" }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, entry: { action: string; meta: unknown }) => {
    h.audits.push({ action: entry.action, meta: entry.meta });
  }),
}));
vi.mock("@/server/storage/safe-file", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/storage/safe-file")>();
  return {
    ...real,
    contentDisposition: (name: string, opts?: { inline?: boolean }) => {
      if (h.failHeader) throw new TypeError("Cannot convert argument to a ByteString");
      return real.contentDisposition(name, opts);
    },
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc1", nameRu: "Султанов Азиз", specializationRu: "Невролог" })),
    },
    patient: { findFirst: vi.fn(async () => ({ id: "p1", fullName: h.patientName })) },
    appointment: {
      findFirst: vi.fn(async () => ({ id: "a1" })),
      findMany: vi.fn(async () => [
        {
          id: "a1",
          date: new Date("2026-09-20T05:00:00Z"),
          endDate: new Date("2026-09-20T05:30:00Z"),
          medicalCaseId: null,
          primaryService: { nameRu: "Консультация невролога" },
          visitNote: {
            diagnosisCode: "G43.0",
            diagnosisName: h.diagnosisName,
            additionalDiagnoses: [],
            prescriptions: ["=HYPERLINK(\"http://evil\",\"x\")"],
            advice: ["+1 стакан воды", "@sum", "-перерыв"],
            bodyMarkdown: "Жалобы на головную боль",
          },
        },
      ]),
      groupBy: vi.fn(async () => []),
    },
  },
}));

import { GET } from "@/app/api/crm/doctors/me/patients/[patientId]/visits/export/route";
import { contentDisposition } from "@/server/storage/safe-file";

const get = () =>
  GET(new Request("https://x/api/crm/doctors/me/patients/p1/visits/export?format=csv"));

beforeEach(() => {
  h.audits = [];
  h.patientName = "Иванов Иван Иванович";
  h.failHeader = false;
});

describe("GET …/visits/export (DC-03)", () => {
  it("answers 200 text/csv for a Cyrillic name, with an ASCII fallback and filename*", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const cd = res.headers.get("content-disposition")!;
    expect(cd).toMatch(/^attachment; filename="visits-[\x20-\x7E]+\.csv"; filename\*=UTF-8''/);
    const star = cd.split("filename*=UTF-8''")[1]!;
    expect(decodeURIComponent(star)).toMatch(/^visits-Иванов-Иван-Иванович-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(h.audits.map((a) => a.action)).toEqual(["visit_list.exported"]);
  });

  it("keeps an Uzbek name with its apostrophe letters readable and the header valid", async () => {
    h.patientName = "Ra'no Mo‘minova";
    const res = await get();
    expect(res.status).toBe(200);
    const star = res.headers.get("content-disposition")!.split("filename*=UTF-8''")[1]!;
    expect(star).not.toContain("'");
    expect(decodeURIComponent(star)).toMatch(/^visits-Ra-no-Mo-minova-/);
  });

  it("writes no «exported» audit row when the response cannot be built", async () => {
    h.failHeader = true;
    // The handler throws (Next answers 500); either way nothing is logged.
    const outcome = await get().then(
      (res) => res.status,
      () => "threw",
    );
    expect([500, "threw"]).toContain(outcome);
    expect(h.audits).toEqual([]);
  });

  it("formula-looking cells are shown as text, the rest unchanged", async () => {
    const body = await (await get()).text();
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(body).toContain(`"'+1 стакан воды | @sum | -перерыв"`);
    expect(body).toContain(`"Мигрень без ауры"`);
    expect(body).toContain(`"G43.0"`);
  });
});

describe("contentDisposition", () => {
  it("is always a valid header value", () => {
    for (const name of ["Иванов.csv", 'a"b\\c.pdf', "Ra'no (1).csv", "plain.pdf"]) {
      const value = contentDisposition(name);
      expect(() => new Headers({ "Content-Disposition": value }), name).not.toThrow();
      expect(value.match(/filename="([^"]*)"/)?.[1], name).not.toMatch(/["\\]/);
    }
    expect(contentDisposition("a.pdf", { inline: true })).toMatch(/^inline;/);
  });
});
