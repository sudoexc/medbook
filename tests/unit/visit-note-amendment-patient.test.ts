/**
 * Audit G3-03 — a correction of a signed conclusion reaches the patient.
 *
 * Before: POST amendments wrote the row and an audit entry, nothing else.
 * The Mini App visit screen read only the original diagnosis and handout,
 * so the patient kept following a dose the doctor had corrected; nobody
 * told him. Now:
 *   - the visit summary carries the amendments (text, reason, date), oldest
 *     first, under the original text;
 *   - `visit-note.amended` is delivered to the patient's stream and
 *     refreshes the visit screen and the visits list;
 *   - the patient gets «врач внёс исправление» in Telegram (and the Mini App
 *     inbox), as a transactional message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  note: null as Record<string, unknown> | null,
  sends: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "p1",
          patient: { id: "p1", fullName: "Karimova Dilnoza", preferredLang: "RU" },
        },
      });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
    ownerPatientId: "p1",
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findFirst: vi.fn(async () => state.note),
    },
    notificationSend: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.sends.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

import { GET as visitSummary } from "@/app/api/miniapp/visit-summary/[appointmentId]/route";
import {
  amendmentNoticeText,
  queueAmendmentNotice,
} from "@/server/visit-notes/amendment-notice";
import { MINIAPP_DELIVERABLE_TYPES } from "@/app/api/miniapp/events/route";
import { MINIAPP_INVALIDATION_MAP } from "@/app/c/[slug]/my/_hooks/use-miniapp-live-events";
import { EVENT_TYPES, parseEvent } from "@/server/realtime/events";

beforeEach(() => {
  state.note = null;
  state.sends = [];
});

describe("the Mini App visit summary", () => {
  it("returns the doctor's corrections under the original, oldest first", async () => {
    state.note = {
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [],
      patientHandoutMarkdown: "Суматриптан 50 мг",
      followUpDays: null,
      followUpDate: null,
      finalizedAt: new Date("2026-09-29T06:00:00Z"),
      documentNumber: "NF-2026-000042",
      conclusionDocument: null,
      doctor: { id: "doc_1" },
      appointment: { date: new Date("2026-09-29T05:00:00Z"), time: "10:00" },
      amendments: [
        {
          id: "am_1",
          reason: "ошибка в дозировке",
          text: "Верно: суматриптан 25 мг",
          createdAt: new Date("2026-10-01T06:00:00Z"),
        },
      ],
    };
    const res = await visitSummary(new Request("https://x/api/miniapp/visit-summary/apt_1"));
    const { summary } = (await res.json()) as { summary: Record<string, unknown> };
    // The signed text stays as issued.
    expect(summary.handoutMarkdown).toBe("Суматриптан 50 мг");
    expect(summary.amendments).toEqual([
      {
        id: "am_1",
        reason: "ошибка в дозировке",
        text: "Верно: суматриптан 25 мг",
        createdAt: "2026-10-01T06:00:00.000Z",
      },
    ]);
    const { prisma } = await import("@/lib/prisma");
    const args = (prisma.visitNote.findFirst as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls[0]![0];
    expect((args.select as Record<string, unknown>).amendments).toMatchObject({
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("the live refresh", () => {
  it("visit-note.amended is a real event the patient stream delivers", () => {
    expect(EVENT_TYPES).toContain("visit-note.amended");
    expect(MINIAPP_DELIVERABLE_TYPES.has("visit-note.amended")).toBe(true);
    const keys = (MINIAPP_INVALIDATION_MAP["visit-note.amended"] ?? []).map((p) => p.join("/"));
    expect(keys).toContain("miniapp/visit-summary");
    expect(keys).toContain("miniapp/appointments");
  });

  it("its payload validates with the amendment id", () => {
    const e = parseEvent({
      type: "visit-note.amended",
      clinicId: "c1",
      at: new Date().toISOString(),
      payload: { visitNoteId: "vn_1", appointmentId: "apt_1", patientId: "p1", amendmentId: "am_1" },
    });
    expect(e.type).toBe("visit-note.amended");
  });
});

describe("the patient's message", () => {
  const visitDate = new Date("2026-09-29T05:00:00Z");

  it("ru and uz texts name the doctor and the visit date, with no dash", () => {
    const ru = amendmentNoticeText({
      locale: "ru",
      patientName: "Karimova Dilnoza Aliyevna",
      doctorName: "Султанов Азиз",
      visitDate,
    });
    expect(ru).toContain("Dilnoza");
    expect(ru).toContain("Султанов Азиз");
    expect(ru).toContain("29.09.2026");
    expect(ru).toMatch(/исправление в заключение/);
    const uz = amendmentNoticeText({
      locale: "uz",
      patientName: "Karimova Dilnoza",
      doctorName: "Sultanov Aziz",
      visitDate,
    });
    expect(uz).toContain("Sultanov Aziz");
    expect(uz).toMatch(/tuzatish kiritdi/);
    for (const text of [ru, uz]) expect(text).not.toMatch(/[—–]/);
  });

  function note(patient: Record<string, unknown>) {
    return {
      appointmentId: "apt_1",
      finalizedAt: new Date("2026-09-29T06:00:00Z"),
      patient: {
        id: "p1",
        fullName: "Karimova Dilnoza",
        telegramId: "777",
        preferredLang: "UZ",
        marketingOptOut: false,
        deletedAt: null,
        ...patient,
      },
      doctor: { nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
      appointment: { date: visitDate },
    };
  }

  it("queues Telegram and the Mini App inbox, in the patient's language", async () => {
    state.note = note({});
    expect(await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).toEqual({ queued: 2 });
    expect(state.sends.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    const tg = state.sends.find((s) => s.channel === "TG")!;
    expect(tg).toMatchObject({
      clinicId: "c1",
      patientId: "p1",
      appointmentId: "apt_1",
      recipient: "777",
      status: "QUEUED",
    });
    expect(String(tg.body)).toContain("Sultanov Aziz");
  });

  it("is transactional: a marketing opt-out still hears about the correction", async () => {
    state.note = note({ marketingOptOut: true });
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(2);
  });

  it("a card without Telegram gets the inbox only; a deleted card nothing", async () => {
    state.note = note({ telegramId: null });
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(1);
    expect(state.sends.map((s) => s.channel)).toEqual(["INAPP"]);
    state.sends = [];
    state.note = note({ deletedAt: new Date() });
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(0);
    expect(state.sends).toHaveLength(0);
  });
});
