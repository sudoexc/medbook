/**
 * Clinic request 29.09.2026: the control visit by any number of days or an
 * exact day. The background worker is where it reaches the patient's PDF
 * and the reception desk.
 *
 * Pinned (acceptance), driving the real sweeps against a mocked prisma:
 *   1. The patient's PDF says «через N дн. · ≈ date» for days and the bare
 *      date for an exact day (ru and uz), and the sweep asks for the day.
 *   2. The reception task falls due on the named day (marked exact, so the
 *      card drops «~»), or on the signature's Tashkent calendar day plus N;
 *      it surfaces a week ahead and expires after the seventh day past due.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const OCT_15 = new Date("2026-10-15T00:00:00.000Z");

const state = {
  notes: [] as Row[],
  findManyArgs: [] as Row[],
  renders: [] as Row[],
};

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "SYSTEM" as const }),
}));
vi.mock("@/server/clinical-forms/numbering", () => ({
  newVerifyToken: () => "tok_MINTED",
}));
vi.mock("@/server/queue", () => ({
  getQueue: () => ({
    registerWorker: vi.fn(),
    repeat: vi.fn(() => ({ stop: vi.fn() })),
  }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async (_b: unknown, key: string) => ({
    url: `https://files/medbook/${key}`,
    key,
  })),
}));
vi.mock("@/server/visit-notes/conclusion-pdf", () => ({
  renderConclusionPdf: vi.fn(async (input: Row) => {
    state.renders.push(input);
    return Buffer.from("pdf");
  }),
}));
vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: (x: { notes: string | null }) => x,
}));
vi.mock("@/server/actions/repository", () => ({
  upsertAction: vi.fn(async () => undefined),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    document: {
      upsert: vi.fn(async () => ({ id: "doc_1" })),
      findUnique: vi.fn(async () => null),
    },
    prescription: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: "rx_1" })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    $executeRaw: vi.fn(async () => 1),
  };
  return {
    prisma: {
      visitNote: {
        findMany: vi.fn(async (args: Row) => {
          state.findManyArgs.push(args);
          return state.notes;
        }),
        update: vi.fn(async () => ({})),
      },
      clinic: {
        findUnique: vi.fn(async () => ({
          nameRu: "Клиника",
          nameUz: "Klinika",
          addressRu: null,
          addressUz: null,
          phone: null,
          brandColor: null,
          medicationRemindersEnabled: false,
          medicationSlotTimes: null,
        })),
      },
      document: tx.document,
      prescription: tx.prescription,
      visitNoteRevision: tx.visitNoteRevision,
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(async <T,>(fn: (t: unknown) => Promise<T>) => fn(tx)),
    },
  };
});

function sweepNote(over: Row = {}): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    appointmentId: "apt_1",
    status: "FINALIZED",
    patientHandoutMarkdown: "# Памятка\n- Режим сна",
    documentNumber: "NF-2026-000042",
    // 29 Sep 2026, 23:30 Tashkent.
    finalizedAt: new Date("2026-09-29T18:30:00.000Z"),
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    handoutStaleAt: null,
    amendments: [],
    patient: { fullName: "Рахимов Сардор", preferredLang: "RU" },
    doctor: { nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
    appointment: { date: new Date("2026-09-29T13:00:00.000Z"), time: "18:00" },
    visitPrescriptions: [],
    ...over,
  };
}

const NOW = new Date("2026-09-29T19:00:00.000Z");

beforeEach(() => {
  state.notes = [];
  state.findManyArgs = [];
  state.renders = [];
});

describe("the patient's PDF", () => {
  async function render(over: Row): Promise<string | null> {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");
    state.notes = [sweepNote(over)];
    await mod.runVisitNoteHandoutTick(NOW);
    expect(state.renders).toHaveLength(1);
    return state.renders[0]!.followUpLine as string | null;
  }

  it("asks the database for the day", async () => {
    await render({});
    const select = state.findManyArgs[0]!.select as Row;
    expect(select.followUpDate).toBe(true);
    expect(select.followUpDays).toBe(true);
  });

  it("ru: days are counted in Tashkent calendar days from the signature", async () => {
    // 29 Sep (Tashkent) + 14 = 13 Oct.
    expect(await render({ followUpDays: 14 })).toBe("через 14 дн. · ≈ 13.10.2026");
  });

  it("ru: an exact day is the date alone", async () => {
    expect(await render({ followUpDays: 16, followUpDate: OCT_15 })).toBe(
      "15.10.2026",
    );
  });

  it("uz: the same in Uzbek", async () => {
    const patient = { fullName: "Rahimov Sardor", preferredLang: "UZ" };
    expect(await render({ followUpDays: 14, patient })).toMatch(
      /^14 kundan keyin · ≈ 13\D10\D2026$/,
    );
    state.renders = [];
    expect(await render({ followUpDate: OCT_15, patient })).toMatch(
      /^15\D10\D2026$/,
    );
  });

  it("no plan, no line", async () => {
    expect(await render({})).toBeNull();
  });
});

describe("the reception task", () => {
  async function bridge(over: Row) {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");
    const repo = await import("@/server/actions/repository");
    state.notes = [sweepNote(over)];
    await mod.runMedicationBridgeTick(NOW);
    return vi.mocked(repo.upsertAction);
  }

  it("asks the database for the day", async () => {
    await bridge({});
    const select = state.findManyArgs[0]!.select as Row;
    expect(select.followUpDate).toBe(true);
  });

  it("falls due on the day the doctor named, marked exact", async () => {
    const upsert = await bridge({ followUpDays: 16, followUpDate: OCT_15 });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [, clinicId, payload, options] = upsert.mock.calls[0]!;
    expect(clinicId).toBe("c1");
    expect(payload).toMatchObject({
      type: "VISIT_FOLLOW_UP_DUE",
      visitNoteId: "vn_1",
      dueDate: "2026-10-15",
      exactDate: true,
    });
    // A week ahead at 09:00 Tashkent; gone at midnight after 22 Oct.
    expect(options?.surfaceAt?.toISOString()).toBe("2026-10-08T04:00:00.000Z");
    expect(options?.expiresAt?.toISOString()).toBe("2026-10-22T19:00:00.000Z");
  });

  it("days count from the signature's Tashkent day, not its UTC one", async () => {
    // Signed 30 Sep at 00:30 Tashkent (still 29 Sep in UTC): due 7 Oct.
    const upsert = await bridge({
      followUpDays: 7,
      finalizedAt: new Date("2026-09-29T19:30:00.000Z"),
    });
    const [, , payload] = upsert.mock.calls[0]!;
    expect(payload).toMatchObject({ dueDate: "2026-10-07" });
    expect(payload).not.toHaveProperty("exactDate");
  });

  it("no plan, no task", async () => {
    const upsert = await bridge({});
    expect(upsert).not.toHaveBeenCalled();
  });
});
