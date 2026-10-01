/**
 * Audit DC-06 — the visit history showed a signed conclusion without the
 * corrections appended to it afterwards. A doctor corrected «карбамазепин
 * 400 мг» to 200 мг two days after signing; a month later the visit page and
 * the history row still read 400 mg with no sign of a correction.
 *
 * Pinned:
 *   1. The visit page lists the corrections (date, author, reason, text)
 *      above the original fields, and shows nothing extra without them.
 *   2. The doctor's visits API counts the corrections per visit.
 *   3. Both history lists badge a visit that has corrections.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  getLocale: async () => "ru",
}));

const db = vi.hoisted(() => ({
  visitSelect: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (_opts: unknown, fn: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      fn({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u_doc", role: "DOCTOR" },
      });
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => ({
        id: "doc_1",
        nameRu: "Султанов Азиз",
        specializationRu: "Невролог",
      })),
    },
    patient: { findFirst: vi.fn(async () => ({ id: "p1" })) },
    appointment: {
      findFirst: vi.fn(async () => ({ id: "a0" })),
      findMany: vi.fn(async (args: { select: Record<string, unknown> }) => {
        db.visitSelect = args.select;
        return db.rows;
      }),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => db.rows.length),
    },
    document: { findMany: vi.fn(async () => []) },
    labOrder: { findMany: vi.fn(async () => []) },
  },
}));

import { VisitNoteReadOnly } from "@/app/[locale]/doctor/visits/[patientId]/[visitId]/_components/visit-note-readonly";

const baseNote = {
  id: "vn_1",
  status: "FINALIZED" as const,
  startedAt: "2026-08-20T05:00:00.000Z",
  finalizedAt: "2026-08-20T05:40:00.000Z",
  diagnosisCode: "G40.2",
  diagnosisName: "Эпилепсия",
  additionalDiagnoses: [],
  complaints: [],
  anamnesis: [],
  examination: [],
  prescriptions: ["Карбамазепин 400 мг — по 1 таб 2 раза в день"],
  advice: [],
  bodyMarkdown: null,
  aiGenerated: false,
  amendments: [] as Array<{
    id: string;
    reason: string;
    text: string;
    createdAt: string;
    author: string | null;
  }>,
  appointment: null,
};

async function html(note: typeof baseNote) {
  const el = await VisitNoteReadOnly({ note });
  return renderToStaticMarkup(el as React.ReactElement);
}

beforeEach(() => {
  db.visitSelect = null;
  db.rows = [];
});

describe("DC-06: the visit page shows the corrections", () => {
  it("lists each correction with its reason, text and author, above the diagnosis", async () => {
    const out = await html({
      ...baseNote,
      amendments: [
        {
          id: "am_1",
          reason: "ошибка в дозировке",
          text: "Карбамазепин 200 мг, не 400",
          createdAt: "2026-08-22T06:00:00.000Z",
          author: "Султанов Азиз",
        },
      ],
    });
    expect(out).toContain("doctor.visits.note.amendments");
    expect(out).toContain("Карбамазепин 200 мг, не 400");
    expect(out).toContain("doctor.visits.note.amendmentReason");
    expect(out).toContain("ошибка в дозировке");
    expect(out).toContain("Султанов Азиз");
    // Above the original text the correction supersedes.
    expect(out.indexOf("Карбамазепин 200 мг")).toBeLessThan(
      out.indexOf("doctor.visits.note.diagnosisIcd10"),
    );
  });

  it("adds nothing for a conclusion that was never corrected", async () => {
    const out = await html(baseNote);
    expect(out).not.toContain("doctor.visits.note.amendments");
  });
});

describe("DC-06: the visits API counts corrections", () => {
  it("asks for the count and returns it per visit", async () => {
    db.rows = [
      {
        id: "a1",
        date: new Date("2026-08-20T05:00:00.000Z"),
        endDate: new Date("2026-08-20T05:30:00.000Z"),
        durationMin: 30,
        primaryService: null,
        medicalCaseId: null,
        visitNote: {
          id: "vn_1",
          status: "FINALIZED",
          diagnosisCode: "G40.2",
          diagnosisName: "Эпилепсия",
          additionalDiagnoses: null,
          prescriptions: [],
          advice: [],
          visitPrescriptions: [],
          _count: { amendments: 2 },
        },
        documents: [],
        labOrders: [],
      },
      {
        id: "a2",
        date: new Date("2026-07-20T05:00:00.000Z"),
        endDate: new Date("2026-07-20T05:30:00.000Z"),
        durationMin: 30,
        primaryService: null,
        medicalCaseId: null,
        visitNote: null,
        documents: [],
        labOrders: [],
      },
    ];
    const { GET } = await import(
      "@/app/api/crm/doctors/me/patients/[patientId]/visits/route"
    );
    const res = await GET(
      new Request("https://x/api/crm/doctors/me/patients/p1/visits"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string; amendmentsCount: number }>;
    };
    expect(body.rows.map((r) => [r.id, r.amendmentsCount])).toEqual([
      ["a1", 2],
      ["a2", 0],
    ]);
    const noteSelect = (db.visitSelect?.visitNote as { select: Record<string, unknown> })
      .select;
    expect(noteSelect._count).toEqual({ select: { amendments: true } });
  });
});

describe("DC-06: the history lists badge a corrected visit", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the patient card's visits section", () => {
    const src = read(
      "src/app/[locale]/doctor/patients/[id]/_components/visits-section.tsx",
    );
    expect(src).toMatch(/amendmentsCount \?\? 0\) > 0/);
    expect(src).toContain('t("visits.amended")');
  });

  it("the /doctor/visits table", () => {
    const src = read(
      "src/app/[locale]/doctor/visits/[patientId]/_components/visits-list.tsx",
    );
    expect(src).toMatch(/amendmentsCount \?\? 0\) > 0/);
    expect(src).toContain('t("table.amended")');
  });
});
