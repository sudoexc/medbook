/**
 * Clinic request 29.09.2026: the control visit by any number of days or an
 * exact day. The routes that write and read it, each driven for real
 * against a mocked prisma, on 29 Sep 2026 at noon Tashkent.
 *
 * Pinned (acceptance):
 *   1. PATCH stores an exact day as a DATE plus its distance in days, and a
 *      count of days clears a day held before. Today, a past day and one
 *      beyond a year are refused whole with a reason the card puts into
 *      words; the edit window is still checked first.
 *   2. A signed note corrected in the window records the day in its EDITED
 *      revision and re-renders the PDF; finalize puts it in the SIGNED one.
 *   3. The printed conclusion says «через N дн. · ≈ date» for days and just
 *      the date for an exact day, in ru and uz.
 *   4. The Mini App (visit summary and visits list) gets the day and says
 *      whether the doctor named it.
 *   5. Review fixes: signing refuses an exact day that has gone by since it
 *      was picked (unless the note is locked), and a plan corrected on a
 *      signed note moves or retires the reception's task at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;
// 29 Sep 2026, 12:00 Tashkent.
const NOW = new Date("2026-09-29T07:00:00.000Z");
const OCT_15 = new Date("2026-10-15T00:00:00.000Z");

const state = {
  note: null as Row | null,
  noteUpdates: [] as Row[],
  revisions: [] as Row[],
  findFirstArgs: [] as Row[],
  appointmentRows: [] as Row[],
  actions: [] as Row[],
  actionLookups: 0,
};

const TASK_KEY = "VISIT_FOLLOW_UP_DUE:visitNoteId=vn_1";

function note(over: Row = {}): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    startedAt: null,
    finalizedAt: null,
    firstFinalizedAt: null,
    documentNumber: null,
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    additionalDiagnoses: [],
    complaints: [],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: ["Режим сна"],
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение.",
    patientHandoutMarkdown: null,
    handoutStaleAt: null,
    medicationsBridgedAt: null,
    aiGenerated: false,
    updatedAt: new Date(NOW.getTime() - HOUR),
    patient: {
      id: "p1",
      fullName: "Рахимов Сардор",
      phone: "+998901234567",
      telegramId: "42",
      birthDate: null,
      gender: "MALE",
      preferredLang: "RU",
    },
    doctor: {
      id: "doc_1",
      nameRu: "Султанов Азиз",
      nameUz: "Sultanov Aziz",
      specializationRu: "Невролог",
      specializationUz: "Nevrolog",
    },
    clinic: { nameRu: "NeuroFax" },
    appointment: {
      id: "apt_1",
      date: new Date(NOW.getTime() - 2 * HOUR),
      time: "10:00",
      channel: "BOOKING",
      startedAt: null,
      status: "IN_PROGRESS",
      completedAt: null,
      endDate: new Date(NOW.getTime() + HOUR),
      queueStatus: "IN_PROGRESS",
      doctorId: "doc_1",
      patientId: "p1",
      cabinetId: null,
    },
    visitPrescriptions: [],
    amendments: [],
    ...over,
  };
}

function signed(over: Row = {}): Row {
  const at = new Date(NOW.getTime() - 2 * HOUR);
  return note({
    status: "FINALIZED",
    finalizedAt: at,
    firstFinalizedAt: at,
    documentNumber: "NF-2026-000042",
    patientHandoutMarkdown: "# Памятка для пациента\n",
    appointment: { ...(note().appointment as Row), status: "COMPLETED", completedAt: at },
    ...over,
  });
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/icd10/clinic-catalog", () => ({
  learnClinicDiagnosis: vi.fn(async () => undefined),
}));
vi.mock("@/server/services/document-number", () => ({
  allocateDocumentNumber: vi.fn(async () => "NF-2026-000099"),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/server/appointments/completion-effects", () => ({
  runCompletionEffects: vi.fn(async () => undefined),
}));
vi.mock("@/server/visit-notes/previous-visit", () => ({
  findPreviousFinalizedVisit: vi.fn(async () => null),
}));
vi.mock("@/server/storage/inline-image", () => ({
  inlineStorageImage: vi.fn(async () => null),
}));
vi.mock("@/server/telegram/invite-token", () => ({
  mintOrReuseInviteUrl: vi.fn(async () => null),
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
          patient: { preferredLang: "RU" },
        },
      });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({ ok: true, patientId: "p1" })),
}));
vi.mock("@/server/miniapp/link-token", () => ({
  miniAppDocumentUrl: vi.fn(() => "https://x/doc"),
}));
vi.mock("@/server/appointments/public-ticket", () => ({
  queueTicketToken: () => "qt",
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    visitNote: {
      findUnique: vi.fn(async () => state.note),
      findFirst: vi.fn(async (args: Row) => {
        state.findFirstArgs.push(args);
        return state.note;
      }),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.noteUpdates.push(data);
        state.note = { ...state.note, ...data, updatedAt: new Date() };
        return state.note;
      }),
      count: vi.fn(async () => 0),
      // The conditional claim of the draft (VW-19): this note is a draft.
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    visitPrescription: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () => state.revisions.at(-1) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.revisions.push(data);
        return { id: `rev_${data.revision}`, revision: data.revision };
      }),
    },
    document: { findUnique: vi.fn(async () => null) },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Султанов Азиз" })),
    },
    clinic: {
      findUnique: vi.fn(async () => ({
        id: "c1",
        nameRu: "NeuroFax",
        nameUz: "NeuroFax",
        addressRu: null,
        addressUz: null,
        phone: null,
        logoUrl: null,
        letterheadUrl: null,
        brandColor: null,
      })),
    },
    appointment: {
      findMany: vi.fn(async () => state.appointmentRows),
      update: vi.fn(async ({ data }: { data: Row }) => ({
        ...(state.note?.appointment as Row),
        ...data,
      })),
    },
    patientDiagnosis: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "pd_1" })),
      update: vi.fn(async () => ({ id: "pd_1" })),
    },
    // The reception's tasks, in memory, behind the real upsert / retire.
    action: {
      findUnique: vi.fn(
        async ({ where }: { where: { clinicId_dedupeKey: Row } }) => {
          state.actionLookups += 1;
          return (
            state.actions.find(
              (a) => a.dedupeKey === where.clinicId_dedupeKey.dedupeKey,
            ) ?? null
          );
        },
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `act_${state.actions.length + 1}`, ...data };
        state.actions.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.actions.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] }; status: { in: string[] } };
          data: Row;
        }) => {
          let count = 0;
          for (const a of state.actions) {
            if (
              where.id.in.includes(a.id as string) &&
              where.status.in.includes(a.status as string)
            ) {
              Object.assign(a, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

// ----- helpers -------------------------------------------------------------

async function patch(body: Row): Promise<Response> {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/visit-notes/vn_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function print(lang: "ru" | "uz"): Promise<string> {
  vi.resetModules();
  const { GET } = await import("@/app/api/crm/visit-notes/[id]/print/route");
  const res = await GET(
    new Request(`https://x/api/crm/visit-notes/vn_1/print?lang=${lang}&embed=1`),
  );
  expect(res.status).toBe(200);
  return res.text();
}

/** The control-visit section of the printed conclusion. */
function followUpSection(html: string, heading: string): string {
  const at = html.indexOf(`<h3>${heading}</h3>`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</section>", at));
}

beforeEach(() => {
  // Only the clock: promises and timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.note = note();
  state.noteUpdates = [];
  state.revisions = [];
  state.findFirstArgs = [];
  state.appointmentRows = [];
  state.actions = [];
  state.actionLookups = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ----- PATCH ---------------------------------------------------------------

describe("PATCH keeps one mode", () => {
  it("an exact day is stored as the DATE, with its distance in days", async () => {
    const res = await patch({ followUpDate: "2026-10-15" });
    expect(res.status).toBe(200);
    expect(state.noteUpdates[0]).toMatchObject({
      followUpDate: OCT_15,
      followUpDays: 16,
    });
  });

  it("a count of days clears a day held before", async () => {
    state.note = note({ followUpDate: OCT_15, followUpDays: 16 });
    await patch({ followUpDays: 21 });
    expect(state.noteUpdates[0]).toMatchObject({
      followUpDays: 21,
      followUpDate: null,
    });
  });

  it("a count of days on a note without a day leaves the column alone", async () => {
    await patch({ followUpDays: 21 });
    expect(state.noteUpdates[0]!.followUpDays).toBe(21);
    expect("followUpDate" in state.noteUpdates[0]!).toBe(false);
  });

  it("the × clears the day, the days and the note", async () => {
    state.note = note({ followUpDate: OCT_15, followUpDays: 16, followUpNote: "ЭЭГ" });
    await patch({ followUpDays: null, followUpDate: null, followUpNote: null });
    expect(state.noteUpdates[0]).toMatchObject({
      followUpDays: null,
      followUpDate: null,
      followUpNote: null,
    });
  });

  for (const [day, problem] of [
    ["2026-09-29", "past"],
    ["2026-09-20", "past"],
    ["2027-09-30", "too_far"],
    ["2026-02-30", "invalid"],
  ] as const) {
    it(`refuses ${day} (${problem}) and writes nothing`, async () => {
      const res = await patch({ followUpDate: day, followUpNote: "ЭЭГ" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        reason: "follow_up_date_out_of_range",
        problem,
      });
      expect(state.noteUpdates).toHaveLength(0);
    });
  }

  it("a malformed date never reaches the route", async () => {
    const res = await patch({ followUpDate: "15.10.2026" });
    expect(res.status).toBe(400);
    expect(state.noteUpdates).toHaveLength(0);
  });

  it("the edit window is checked before the date", async () => {
    const long = new Date(NOW.getTime() - 48 * HOUR);
    state.note = signed({ finalizedAt: long, firstFinalizedAt: long });
    const res = await patch({ followUpDate: "2026-09-01" });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("edit_window_expired");
  });
});

describe("a signed note corrected in the window", () => {
  it("the EDITED revision holds the day; the PDF goes stale", async () => {
    state.note = signed({ followUpDays: 14 });
    const res = await patch({ followUpDate: "2026-10-15" });
    expect(res.status).toBe(200);

    expect(state.noteUpdates[0]!.handoutStaleAt).toBeInstanceOf(Date);
    const edited = state.revisions.find((r) => r.kind === "EDITED")!;
    expect(edited.changedFields).toEqual(
      expect.arrayContaining(["followUpDate", "followUpDays"]),
    );
    expect((edited.content as Row).followUpDate).toBe("2026-10-15");
    // The state it replaced planned days and says so by leaving the key out.
    const before = state.revisions.find((r) => r.kind === "PRE_EDIT")!;
    expect("followUpDate" in (before.content as Row)).toBe(false);
    expect((before.content as Row).followUpDays).toBe(14);
  });
});

async function finalize(): Promise<Response> {
  vi.resetModules();
  const { POST } = await import("@/app/api/crm/visit-notes/[id]/finalize/route");
  return POST(
    new Request("https://x/api/crm/visit-notes/vn_1/finalize", { method: "POST" }),
  );
}

describe("finalize", () => {
  it("the SIGNED revision holds the day", async () => {
    state.note = note({ followUpDate: OCT_15, followUpDays: 16 });
    const res = await finalize();
    expect(res.status).toBe(200);
    const signedRev = state.revisions.find((r) => r.kind === "SIGNED")!;
    expect((signedRev.content as Row).followUpDate).toBe("2026-10-15");
  });

  // Picked on 25 Sep for the 27th, the draft signed on the 29th: the day
  // would reach the patient's PDF and reception already gone.
  for (const [label, day] of [
    ["a day gone by", "2026-09-27"],
    ["today", "2026-09-29"],
  ] as const) {
    it(`refuses to sign ${label} and writes nothing`, async () => {
      state.note = note({
        followUpDate: new Date(`${day}T00:00:00.000Z`),
        followUpDays: 2,
      });
      const res = await finalize();
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        reason: "follow_up_date_out_of_range",
        problem: "past",
      });
      expect(state.noteUpdates).toHaveLength(0);
      expect(state.revisions).toHaveLength(0);
    });
  }

  it("signs a day still ahead, and «через N дней» however late", async () => {
    state.note = note({
      followUpDate: new Date("2026-09-30T00:00:00.000Z"),
      followUpDays: 1,
    });
    expect((await finalize()).status).toBe(200);

    state.note = note({ followUpDays: 3 });
    state.noteUpdates = [];
    expect((await finalize()).status).toBe(200);
  });

  it("a locked reopened draft is signed as it stands", async () => {
    // Signed on the 25th, reverted after its 24h window: the PATCH would
    // refuse a new day, so refusing the signature would leave it stuck.
    const long = new Date(NOW.getTime() - 4 * 24 * HOUR);
    state.note = note({
      firstFinalizedAt: long,
      documentNumber: "NF-2026-000042",
      followUpDate: new Date("2026-09-27T00:00:00.000Z"),
      followUpDays: 2,
      appointment: { ...(note().appointment as Row), status: "COMPLETED", completedAt: long },
    });
    expect((await finalize()).status).toBe(200);
    expect(state.noteUpdates[0]).toMatchObject({ status: "FINALIZED" });
  });
});

// ----- the reception task after a correction -------------------------------

describe("a signed note's plan corrected in the window", () => {
  /** The task the bridge wrote at the signature: «через 14 дн.», 13 Oct. */
  function bridgedTask(over: Row = {}): Row {
    return {
      id: "act_bridge",
      clinicId: "c1",
      dedupeKey: TASK_KEY,
      type: "VISIT_FOLLOW_UP_DUE",
      severity: "medium",
      status: "SNOOZED",
      snoozeUntil: new Date("2026-10-06T04:00:00.000Z"),
      assigneeRole: "RECEPTIONIST",
      deeplinkPath: "/crm/patients/p1",
      expiresAt: new Date("2026-10-20T19:00:00.000Z"),
      doneAt: null,
      dismissedAt: null,
      outcome: null,
      updatedAt: new Date(NOW.getTime() - HOUR),
      payload: {
        type: "VISIT_FOLLOW_UP_DUE",
        visitNoteId: "vn_1",
        patientId: "p1",
        patientName: "Рахимов Сардор",
        doctorId: "doc_1",
        doctorName: "Султанов Азиз",
        dueDate: "2026-10-13",
        followUpNote: "",
      },
      ...over,
    };
  }

  it("an exact day moves the task to that day, marked exact", async () => {
    state.note = signed({ followUpDays: 14 });
    state.actions = [bridgedTask()];
    const res = await patch({ followUpDate: "2026-10-20", followUpNote: "ЭЭГ" });
    expect(res.status).toBe(200);

    expect(state.actions).toHaveLength(1);
    const task = state.actions[0]!;
    expect(task.payload).toMatchObject({
      dueDate: "2026-10-20",
      exactDate: true,
      followUpNote: "ЭЭГ",
    });
    // A week ahead at 09:00, gone after the seventh day past it.
    expect(task.snoozeUntil).toEqual(new Date("2026-10-13T04:00:00.000Z"));
    expect(task.expiresAt).toEqual(new Date("2026-10-27T19:00:00.000Z"));
  });

  it("a new count of days moves it too, from the signature", async () => {
    state.note = signed({ followUpDays: 16, followUpDate: OCT_15 });
    state.actions = [
      bridgedTask({
        payload: {
          ...(bridgedTask().payload as Row),
          dueDate: "2026-10-15",
          exactDate: true,
        },
      }),
    ];
    await patch({ followUpDays: 30 });
    const payload = state.actions[0]!.payload as Row;
    expect(payload.dueDate).toBe("2026-10-29");
    expect(payload).not.toHaveProperty("exactDate");
  });

  it("the × retires the task instead of leaving a call for nothing", async () => {
    state.note = signed({ followUpDays: 14, followUpNote: "ЭЭГ" });
    state.actions = [bridgedTask()];
    const res = await patch({
      followUpDays: null,
      followUpDate: null,
      followUpNote: null,
    });
    expect(res.status).toBe(200);
    expect(state.actions[0]!.status).toBe("EXPIRED");
  });

  it("a call reception already made stays theirs", async () => {
    state.note = signed({ followUpDays: 14 });
    state.actions = [bridgedTask({ status: "DONE", doneAt: new Date(NOW.getTime() - HOUR) })];
    await patch({ followUpDays: null, followUpDate: null });
    expect(state.actions[0]!.status).toBe("DONE");
  });

  it("other corrections, and a draft's plan, leave reception alone", async () => {
    state.note = signed({ followUpDays: 14 });
    state.actions = [bridgedTask()];
    await patch({ advice: ["Режим сна", "Меньше экранов"] });

    state.note = note();
    await patch({ followUpDate: "2026-10-20" });

    expect(state.actionLookups).toBe(0);
    expect((state.actions[0]!.payload as Row).dueDate).toBe("2026-10-13");
  });
});

// ----- print ---------------------------------------------------------------

describe("the printed conclusion", () => {
  it("ru: days read «через N дн. · ≈ date», counted from the signature", async () => {
    // Signed 29 Sep at 23:30 Tashkent: 14 calendar days is 13 Oct.
    state.note = signed({
      followUpDays: 14,
      finalizedAt: new Date("2026-09-29T18:30:00.000Z"),
    });
    const section = followUpSection(await print("ru"), "Контрольный визит");
    expect(section).toContain("через 14 дн. · ≈ 13.10.2026");
  });

  it("ru: an exact day prints as the date alone", async () => {
    state.note = signed({ followUpDays: 16, followUpDate: OCT_15, followUpNote: "ЭЭГ" });
    const section = followUpSection(await print("ru"), "Контрольный визит");
    expect(section).toContain("<strong>15.10.2026</strong>");
    expect(section).not.toContain("≈");
    expect(section).not.toContain("дн.");
    expect(section).toContain("ЭЭГ");
  });

  it("uz: the same in Uzbek", async () => {
    state.note = signed({ followUpDays: 14 });
    const days = followUpSection(await print("uz"), "Nazorat tashrifi");
    expect(days).toMatch(/14 kundan keyin · ≈ 13\D10\D2026/);

    state.note = signed({ followUpDays: 16, followUpDate: OCT_15 });
    const exact = followUpSection(await print("uz"), "Nazorat tashrifi");
    expect(exact).toMatch(/<strong>15\D10\D2026<\/strong>/);
    expect(exact).not.toContain("≈");
    expect(exact).not.toContain("kundan keyin");
  });

  it("no plan, no section", async () => {
    state.note = signed();
    expect(await print("ru")).not.toContain("<h3>Контрольный визит</h3>");
  });
});

// ----- Mini App ------------------------------------------------------------

describe("the Mini App", () => {
  function summaryNote(over: Row): Row {
    return {
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [],
      patientHandoutMarkdown: null,
      followUpDays: null,
      followUpDate: null,
      finalizedAt: new Date("2026-09-29T06:00:00.000Z"),
      documentNumber: "NF-2026-000042",
      conclusionDocument: null,
      doctor: { id: "doc_1" },
      appointment: { date: new Date("2026-09-29T05:00:00.000Z"), time: "10:00" },
      // G3-03 — the summary carries the doctor's later corrections.
      amendments: [],
      ...over,
    };
  }

  async function summary(): Promise<Row> {
    vi.resetModules();
    const { GET } = await import(
      "@/app/api/miniapp/visit-summary/[appointmentId]/route"
    );
    const res = await GET(new Request("https://x/api/miniapp/visit-summary/apt_1"));
    return ((await res.json()) as { summary: Row }).summary;
  }

  it("visit summary: the named day, marked exact", async () => {
    state.note = summaryNote({ followUpDays: 16, followUpDate: OCT_15 });
    const s = await summary();
    expect(s.followUpAt).toBe("2026-10-15T07:00:00.000Z");
    expect(s.followUpExact).toBe(true);
    // Asked for, or an exact day would read as «через 16 дней».
    const select = (state.findFirstArgs[0]!.select ?? {}) as Row;
    expect(select.followUpDate).toBe(true);
    // Still reception-internal.
    expect(s).not.toHaveProperty("followUpNote");
  });

  it("visit summary: days are an estimate from the signature", async () => {
    state.note = summaryNote({ followUpDays: 14 });
    const s = await summary();
    expect(s.followUpAt).toBe("2026-10-13T07:00:00.000Z");
    expect(s.followUpExact).toBe(false);
  });

  it("visit summary: no plan", async () => {
    state.note = summaryNote({});
    const s = await summary();
    expect(s.followUpAt).toBeNull();
    expect(s.followUpExact).toBe(false);
  });

  it("visits list: the CTA date follows the same rule", async () => {
    state.appointmentRows = [
      {
        id: "apt_1",
        date: new Date("2026-09-29T05:00:00.000Z"),
        status: "COMPLETED",
        visitNote: {
          followUpDays: 16,
          followUpDate: OCT_15,
          finalizedAt: new Date("2026-09-29T06:00:00.000Z"),
          conclusionDocument: null,
        },
      },
      {
        id: "apt_0",
        date: new Date("2026-09-01T05:00:00.000Z"),
        status: "COMPLETED",
        visitNote: null,
      },
    ];
    vi.resetModules();
    const { GET } = await import("@/app/api/miniapp/appointments/route");
    const res = await GET(
      new Request("https://x/api/miniapp/appointments?clinicSlug=neurofax&scope=past"),
    );
    const { appointments } = (await res.json()) as { appointments: Row[] };
    expect(appointments[0]).toMatchObject({
      followUpAt: "2026-10-15T07:00:00.000Z",
      followUpExact: true,
    });
    expect(appointments[0]).not.toHaveProperty("visitNote");
    expect(appointments[1]).toMatchObject({ followUpAt: null, followUpExact: false });
  });
});
