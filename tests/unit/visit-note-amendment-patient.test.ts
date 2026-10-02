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
 *     inbox), as a transactional message, through the clinic's own
 *     `visit-note.amended` template. Review: it used to be queued with no
 *     template, so the clinic could not switch it off; the row is now
 *     created switched off and nothing goes until the clinic turns it on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  note: null as Record<string, unknown> | null,
  sends: [] as Array<Record<string, unknown>>,
  // The clinic's `visit-note.amended` row, as the database holds it.
  template: null as Record<string, unknown> | null,
  upserts: [] as Array<Record<string, unknown>>,
  appt: null as Record<string, unknown> | null,
  pending: null as Record<string, unknown> | null,
  noChannel: [] as Array<Record<string, unknown>>,
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
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async (args: Record<string, unknown>) => {
    state.noChannel.push(args);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findFirst: vi.fn(async () => state.note),
    },
    notificationTemplate: {
      // ensureClinicTemplate: creates the row when missing, never updates it.
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => {
        state.upserts.push(args);
        if (!state.template) state.template = { id: "tpl_amend", ...args.create };
        return state.template;
      }),
      // findTemplateFor: only an active row of this slug.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const t = state.template;
        if (!t || where.isActive !== true || t.isActive !== true) return null;
        if (where.key !== t.key) return null;
        return t;
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => state.appt),
    },
    notificationSend: {
      findFirst: vi.fn(async () => state.pending),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sends.push(data);
        return { id: `snd_${state.sends.length}`, ...data };
      }),
    },
  },
}));

import { GET as visitSummary } from "@/app/api/miniapp/visit-summary/[appointmentId]/route";
import {
  amendmentNoticeTemplate,
  queueAmendmentNotice,
} from "@/server/visit-notes/amendment-notice";
import { VISIT_NOTE_AMENDED_KEY } from "@/server/notifications/default-templates";
import { TRIGGER_KEYS } from "@/server/notifications/triggers";
import { render } from "@/server/notifications/template";
import { MINIAPP_DELIVERABLE_TYPES } from "@/app/api/miniapp/events/route";
import { MINIAPP_INVALIDATION_MAP } from "@/app/c/[slug]/my/_hooks/use-miniapp-live-events";
import { EVENT_TYPES, parseEvent } from "@/server/realtime/events";

beforeEach(() => {
  state.note = null;
  state.sends = [];
  state.template = null;
  state.upserts = [];
  state.appt = null;
  state.pending = null;
  state.noChannel = [];
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

  it("the default text is the next-intl message with the template's placeholders, ru and uz, no dash", () => {
    const tpl = amendmentNoticeTemplate();
    expect(tpl).toMatchObject({
      key: VISIT_NOTE_AMENDED_KEY,
      channel: "TG",
      category: "TRANSACTIONAL",
      trigger: "MANUAL",
    });
    const ctx = {
      patient: { firstName: "Dilnoza" },
      appointment: { doctor: "Султанов Азиз", date: "29 сентября 2026 г." },
    };
    // The date renders as «29 сентября 2026 г.», so it never ends a sentence.
    expect(render(tpl.bodyRu, ctx)).toBe(
      "Dilnoza, в заключение по приёму 29 сентября 2026 г. врач Султанов Азиз внёс исправление. Откройте приложение клиники, чтобы его прочитать.",
    );
    const uz = render(tpl.bodyUz, {
      ...ctx,
      appointment: { doctor: "Sultanov Aziz", date: "29.09.2026" },
    });
    expect(uz).toContain("Sultanov Aziz");
    expect(uz).toMatch(/tuzatish kiritdi/);
    expect(tpl.nameRu).toBe("Исправление в заключении врача");
    expect(tpl.nameUz).not.toBe("");
    for (const text of [tpl.bodyRu, tpl.bodyUz, tpl.nameRu, tpl.nameUz]) {
      expect(text).not.toMatch(/[—–]/);
    }
  });

  it("is a registered trigger", () => {
    expect(TRIGGER_KEYS).toContain("visit-note.amended");
  });

  function note(patient: Record<string, unknown> = {}) {
    return {
      appointmentId: "apt_1",
      patient: { marketingOptOut: false, deletedAt: null, ...patient },
    };
  }
  function appt(patient: Record<string, unknown> = {}) {
    return {
      id: "apt_1",
      clinicId: "c1",
      patientId: "p1",
      date: visitDate,
      time: "10:00",
      endDate: new Date("2026-09-29T05:30:00Z"),
      status: "COMPLETED",
      confirmedAt: null,
      patient: {
        id: "p1",
        fullName: "Karimova Dilnoza",
        phone: "+998901112233",
        telegramId: "777",
        preferredChannel: "TG",
        preferredLang: "UZ",
        birthDate: null,
        ...patient,
      },
      doctor: { nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
      primaryService: null,
      cabinet: null,
      clinic: {
        id: "c1",
        nameRu: "Неврофакс",
        nameUz: "Neurofax",
        phone: "+998712000000",
        addressRu: null,
        timezone: "Asia/Tashkent",
      },
    };
  }
  /** The clinic switched the message on in /crm/settings/notifications. */
  function switchedOn() {
    state.template = { id: "tpl_amend", ...amendmentNoticeTemplate(), isActive: true };
  }

  it("a clinic that has not switched it on sends nothing, and the row appears switched off", async () => {
    state.note = note();
    state.appt = appt();
    expect(await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).toEqual({
      queued: 0,
      skipped: "template_off",
    });
    expect(state.sends).toHaveLength(0);
    const up = state.upserts[0] as {
      where: { clinicId_key: { clinicId: string; key: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(up.where.clinicId_key).toEqual({ clinicId: "c1", key: VISIT_NOTE_AMENDED_KEY });
    expect(up.create.isActive).toBe(false);
    // The admin's text and switch are never overwritten.
    expect(up.update).toEqual({});
  });

  it("switched on: Telegram and the Mini App inbox, in the patient's language", async () => {
    switchedOn();
    state.note = note();
    state.appt = appt();
    expect(await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).toEqual({
      queued: 2,
    });
    expect(state.sends.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    const tg = state.sends.find((s) => s.channel === "TG")!;
    expect(tg).toMatchObject({
      clinicId: "c1",
      patientId: "p1",
      appointmentId: "apt_1",
      templateId: "tpl_amend",
      recipient: "777",
      status: "QUEUED",
    });
    expect(String(tg.body)).toContain("Sultanov Aziz");
    expect(String(tg.body)).toMatch(/tuzatish kiritdi/);
  });

  it("the admin's edited text is what goes out", async () => {
    switchedOn();
    state.template = {
      ...state.template!,
      bodyRu: "{{patient.firstName}}, врач уточнил заключение.",
    };
    state.note = note();
    state.appt = appt({ preferredLang: "RU" });
    await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" });
    // `patient.firstName` is the given name, the card's second word, as in
    // every template (audit TG-29).
    expect(state.sends[0]!.body).toBe("Dilnoza, врач уточнил заключение.");
  });

  it("switched off again by the clinic: nothing goes", async () => {
    switchedOn();
    state.template = { ...state.template!, isActive: false };
    state.note = note();
    state.appt = appt();
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(0);
    expect(state.sends).toHaveLength(0);
  });

  it("is transactional: a marketing opt-out still hears about the correction", async () => {
    switchedOn();
    state.note = note({ marketingOptOut: true });
    state.appt = appt();
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(2);
  });

  it("a deleted card gets nothing", async () => {
    switchedOn();
    state.note = note({ deletedAt: new Date() });
    state.appt = appt();
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(0);
    expect(state.sends).toHaveLength(0);
  });

  it("a card without Telegram: reception gets the call task, as for every message", async () => {
    switchedOn();
    state.note = note();
    state.appt = appt({ telegramId: null });
    expect(await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).toEqual({
      queued: 0,
      skipped: "no_channel",
    });
    expect(state.sends).toHaveLength(0);
    expect(state.noChannel).toEqual([
      expect.objectContaining({
        patientId: "p1",
        triggerKey: "visit-note.amended",
        appointmentId: "apt_1",
      }),
    ]);
  });

  it("a notice still waiting to go out covers a second correction; a sent one does not", async () => {
    switchedOn();
    state.note = note();
    state.appt = appt();
    state.pending = { id: "snd_waiting" };
    expect(await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).toEqual({
      queued: 0,
      skipped: "pending",
    });
    const { prisma } = await import("@/lib/prisma");
    const where = (
      prisma.notificationSend.findFirst as unknown as {
        mock: { calls: Array<[{ where: Record<string, unknown> }]> };
      }
    ).mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({
      appointmentId: "apt_1",
      templateId: "tpl_amend",
      status: { in: ["QUEUED", "SENDING"] },
    });
    state.pending = null;
    expect((await queueAmendmentNotice({ clinicId: "c1", visitNoteId: "vn_1" })).queued).toBe(2);
  });
});
