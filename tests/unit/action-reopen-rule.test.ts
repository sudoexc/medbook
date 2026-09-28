/**
 * Audit AC-08 — «Отклонить» and «Готово» did nothing: `upsertAction`
 * reopened every DONE / DISMISSED row it touched, so the engine's 15-minute
 * pass (or «Пересчитать сейчас», or the next missed reminder of the same day,
 * or a doctor editing a finalized note) put the task straight back.
 *
 * The rule now (see `closedRowReopens` in `src/server/actions/repository.ts`):
 * a task a person closed comes back only when something genuinely new
 * happened: its subject changed (`actionSubjectOf`), or, for detector types,
 * the signal lapsed for more than `CLOSED_SIGNAL_LAPSE_HOURS` and returned.
 * EXPIRED (closed by the system) still reopens on any upsert.
 *
 * `upsertAction` takes `prisma` as a parameter, so an in-memory store is
 * enough to replay the engine over simulated hours.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actionSubjectOf,
  type ActionPayload,
  type PaymentOverduePayload,
} from "@/lib/actions/types";
import {
  ABANDONED_RESCHEDULE_GRACE_MIN,
  CLOSED_SIGNAL_LAPSE_HOURS,
} from "@/server/actions/config";
import {
  closedRowReopens,
  rescheduleNeverHappened,
  upsertAction,
} from "@/server/actions/repository";

// ── in-memory Action store ───────────────────────────────────────────────────

type Row = Record<string, unknown> & {
  id: string;
  clinicId: string;
  dedupeKey: string;
  status: string;
  updatedAt: Date;
};

function makeStore() {
  const rows = new Map<string, Row>();
  const audits: Array<{ action: string; meta: Record<string, unknown> }> = [];
  let seq = 0;
  const prisma = {
    action: {
      findUnique: async ({
        where,
      }: {
        where: { clinicId_dedupeKey: { clinicId: string; dedupeKey: string } };
      }) =>
        [...rows.values()].find(
          (r) =>
            r.clinicId === where.clinicId_dedupeKey.clinicId &&
            r.dedupeKey === where.clinicId_dedupeKey.dedupeKey,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `act_${++seq}`,
          snoozeUntil: null,
          dismissedAt: null,
          doneAt: null,
          outcome: null,
          ...data,
          updatedAt: new Date(),
        } as unknown as Row;
        rows.set(row.id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = { ...rows.get(where.id)!, ...data, updatedAt: new Date() };
        rows.set(row.id, row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; meta: Record<string, unknown> } }) => {
        audits.push({ action: data.action, meta: data.meta });
        return {};
      },
    },
  };
  return { rows, audits, prisma: prisma as unknown as Parameters<typeof upsertAction>[0] };
}

/** A person pressed «Готово» / «Отклонить» on the row, as the routes do. */
function close(store: ReturnType<typeof makeStore>, id: string, status: "DONE" | "DISMISSED") {
  const row = store.rows.get(id)!;
  store.rows.set(id, {
    ...row,
    status,
    ...(status === "DONE" ? { doneAt: new Date() } : { dismissedAt: new Date() }),
    updatedAt: new Date(),
  });
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date("2026-09-28T05:00:00.000Z"); // 10:00 Tashkent

const debt: PaymentOverduePayload = {
  type: "PAYMENT_OVERDUE",
  appointmentId: "ap_1",
  patientId: "p_1",
  patientName: "Каримов Бахтиёр",
  amountUzs: 45_000_000,
  daysOverdue: 3,
};

afterEach(() => {
  vi.useRealTimers();
});

/** Replays engine passes every 15 minutes from `from` for `hours`. */
async function engineTicks(
  store: ReturnType<typeof makeStore>,
  from: number,
  hours: number,
  payloadAt: (t: number) => ActionPayload,
) {
  for (let t = from; t <= from + hours * HOUR; t += 15 * MIN) {
    vi.setSystemTime(t);
    await upsertAction(store.prisma, "c1", payloadAt(t));
  }
}

describe("a task a person closed stays closed (AC-08 acceptance)", () => {
  it("DISMISSED survives «Пересчитать сейчас» and two scheduler passes with the same payload", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DISMISSED");

    // «Пересчитать сейчас» right away, then two 15-minute passes.
    for (const t of [T0.getTime() + MIN, T0.getTime() + 16 * MIN, T0.getTime() + 31 * MIN]) {
      vi.setSystemTime(t);
      const res = await upsertAction(store.prisma, "c1", debt);
      expect(res.keptClosed).toBe(true);
    }
    const row = store.rows.get(id)!;
    expect(row.status).toBe("DISMISSED");
    expect(row.dismissedAt).toBeInstanceOf(Date);
  });

  it("DONE without an outcome survives a whole day of passes", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DONE");
    await engineTicks(store, T0.getTime(), 24, () => debt);
    expect(store.rows.get(id)!.status).toBe("DONE");
  });

  it("a reading that drifts on its own (days overdue, risk %) is not new", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DISMISSED");
    // The debt paid in cash outside the system keeps ageing every day.
    await engineTicks(store, T0.getTime(), 72, (t) => ({
      ...debt,
      daysOverdue: 3 + Math.floor((t - T0.getTime()) / DAY),
    }));
    const row = store.rows.get(id)!;
    expect(row.status).toBe("DISMISSED");
    // Still refreshed, so an admin's «Вернуть» shows current data.
    expect((row.payload as PaymentOverduePayload).daysOverdue).toBe(6);
  });

  it("stays silent: no audit row and no announcement for a refresh of a closed row", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DISMISSED");
    store.audits.length = 0;
    vi.setSystemTime(T0.getTime() + 15 * MIN);
    const res = await upsertAction(store.prisma, "c1", { ...debt, daysOverdue: 4 });
    expect(res.payloadChanged).toBe(true);
    expect(res.keptClosed).toBe(true);
    expect(store.audits).toHaveLength(0);
  });
});

describe("what does reopen a closed task", () => {
  it("the subject changed: the unconfirmed visit was moved to another time", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const unconfirmed: ActionPayload = {
      type: "UNCONFIRMED_24H",
      appointmentId: "ap_2",
      patientId: "p_2",
      patientName: "Иванов Иван",
      appointmentAt: "2026-09-28T10:00:00.000Z",
      doctorName: "Султанов А.",
    };
    const { id } = await upsertAction(store.prisma, "c1", unconfirmed);
    close(store, id, "DONE");

    vi.setSystemTime(T0.getTime() + 15 * MIN);
    await upsertAction(store.prisma, "c1", unconfirmed);
    expect(store.rows.get(id)!.status).toBe("DONE");

    vi.setSystemTime(T0.getTime() + 30 * MIN);
    const res = await upsertAction(store.prisma, "c1", {
      ...unconfirmed,
      appointmentAt: "2026-09-29T06:00:00.000Z",
    });
    expect(res.keptClosed).toBe(false);
    const row = store.rows.get(id)!;
    expect(row.status).toBe("OPEN");
    expect(row.doneAt).toBeNull();
    expect(row.surfacedAt).toEqual(new Date(T0.getTime() + 30 * MIN));
    expect(store.audits.at(-1)).toMatchObject({
      action: "ACTION_UPDATED",
      meta: { resurrectedFromTerminal: true },
    });
  });

  it("the debt amount changed", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DISMISSED");
    vi.setSystemTime(T0.getTime() + HOUR);
    await upsertAction(store.prisma, "c1", { ...debt, amountUzs: 60_000_000 });
    expect(store.rows.get(id)!.status).toBe("OPEN");
  });

  it("a detector signal that lapsed for longer than the lapse window and came back", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const overload: ActionPayload = {
      type: "DOCTOR_OVERLOAD",
      doctorId: "doc_1",
      doctorName: "Султанов А.",
      queueLength: 9,
      alternativeDoctorIds: [],
    };
    const { id } = await upsertAction(store.prisma, "c1", overload);
    close(store, id, "DONE");
    // Still overloaded for two hours: stays closed.
    await engineTicks(store, T0.getTime(), 2, () => overload);
    expect(store.rows.get(id)!.status).toBe("DONE");

    // The queue clears at noon; the same doctor is overloaded again tomorrow.
    const tomorrow = T0.getTime() + DAY;
    expect(tomorrow - (T0.getTime() + 2 * HOUR)).toBeGreaterThan(
      CLOSED_SIGNAL_LAPSE_HOURS * HOUR,
    );
    vi.setSystemTime(tomorrow);
    await upsertAction(store.prisma, "c1", overload);
    expect(store.rows.get(id)!.status).toBe("OPEN");
  });

  it("a worker restart or a deploy is not a lapse", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    close(store, id, "DISMISSED");
    // Engine down for three hours.
    vi.setSystemTime(T0.getTime() + 3 * HOUR);
    await upsertAction(store.prisma, "c1", debt);
    expect(store.rows.get(id)!.status).toBe("DISMISSED");
  });

  it("EXPIRED, which the system set, reopens on any upsert as before", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);
    store.rows.set(id, { ...store.rows.get(id)!, status: "EXPIRED" });
    vi.setSystemTime(T0.getTime() + 15 * MIN);
    await upsertAction(store.prisma, "c1", debt);
    expect(store.rows.get(id)!.status).toBe("OPEN");
  });
});

/** Reception recorded a call outcome that closes the row, as the outcome
 *  endpoints do (`outcomeStamp`). */
function recordOutcome(
  store: ReturnType<typeof makeStore>,
  id: string,
  outcome: "RESCHEDULED" | "CONFIRMED",
) {
  const row = store.rows.get(id)!;
  store.rows.set(id, {
    ...row,
    status: "DONE",
    doneAt: new Date(),
    outcome,
    outcomeNote: null,
    callbackAt: null,
    resolvedById: "u_reception",
    updatedAt: new Date(),
  });
}

describe("an abandoned «Перенести» (review of AC-08, until AC-10)", () => {
  // Иванов, 15:00 today, not confirmed. At 10:00 reception presses
  // «Перенести»: the outcome closes the rows, then the drawer opens; a call
  // comes in and the drawer is closed without saving.
  const VISIT = "2026-09-28T10:00:00.000Z"; // 15:00 Tashkent
  const unconfirmed: ActionPayload = {
    type: "UNCONFIRMED_24H",
    appointmentId: "ap_ivanov",
    patientId: "p_ivanov",
    patientName: "Иванов Иван",
    appointmentAt: VISIT,
    doctorName: "Султанов А.",
  };
  const risk: ActionPayload = {
    type: "NO_SHOW_RISK_HIGH",
    appointmentId: "ap_ivanov",
    patientId: "p_ivanov",
    patientName: "Иванов Иван",
    risk: 0.67,
    appointmentAt: VISIT,
  };
  const graceMs = ABANDONED_RESCHEDULE_GRACE_MIN * MIN;

  it("the unconfirmed visit comes back once the grace has passed, outcome cleared", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", unconfirmed);
    recordOutcome(store, id, "RESCHEDULED");

    // Still inside the grace: reception may be picking the date right now.
    vi.setSystemTime(T0.getTime() + 15 * MIN);
    expect((await upsertAction(store.prisma, "c1", unconfirmed)).keptClosed).toBe(true);
    expect(store.rows.get(id)!.status).toBe("DONE");

    // The next passes: the visit is still at 15:00, so the move never happened.
    await engineTicks(store, T0.getTime() + 30 * MIN, 0.5, () => unconfirmed);
    const row = store.rows.get(id)!;
    expect(row.status).toBe("OPEN");
    expect(row.doneAt).toBeNull();
    // «Обработано сегодня» must not keep showing «Перенести».
    expect(row.outcome).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(store.audits.at(-1)).toMatchObject({
      action: "ACTION_UPDATED",
      meta: { resurrectedFromTerminal: true, abandonedReschedule: true },
    });
  });

  it("NO_SHOW_RISK_HIGH comes back too: a reschedule that did not happen does not lock", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const expiresAt = new Date(VISIT);
    const { id } = await upsertAction(store.prisma, "c1", risk, { expiresAt });
    recordOutcome(store, id, "RESCHEDULED");

    vi.setSystemTime(T0.getTime() + 15 * MIN);
    await upsertAction(store.prisma, "c1", risk, { expiresAt });
    expect(store.rows.get(id)!.status).toBe("DONE");

    vi.setSystemTime(T0.getTime() + graceMs + 15 * MIN);
    await upsertAction(store.prisma, "c1", { ...risk, risk: 0.7 }, { expiresAt });
    expect(store.rows.get(id)!.status).toBe("OPEN");
  });

  it("any other outcome keeps its lock: «Подтвердил» is not undone by time", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const expiresAt = new Date(VISIT);
    const { id } = await upsertAction(store.prisma, "c1", risk, { expiresAt });
    recordOutcome(store, id, "CONFIRMED");
    for (let t = T0.getTime(); t < expiresAt.getTime(); t += 15 * MIN) {
      vi.setSystemTime(t);
      await upsertAction(store.prisma, "c1", risk, { expiresAt });
    }
    expect(store.rows.get(id)!.status).toBe("DONE");
  });

  it("a saved move reopens through the ordinary rule, and «Готово» on the new row then sticks", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", unconfirmed);
    recordOutcome(store, id, "RESCHEDULED");

    // Saved in the drawer within minutes: the visit is now tomorrow 11:00.
    const moved = { ...unconfirmed, appointmentAt: "2026-09-29T06:00:00.000Z" };
    vi.setSystemTime(T0.getTime() + 15 * MIN);
    await upsertAction(store.prisma, "c1", moved);
    expect(store.rows.get(id)!).toMatchObject({ status: "OPEN", outcome: null });

    // Reception closes the new row by hand; the cleared outcome keeps this
    // «Готово» from reading as another abandoned reschedule.
    close(store, id, "DONE");
    await engineTicks(store, T0.getTime() + 30 * MIN, 24, () => moved);
    expect(store.rows.get(id)!.status).toBe("DONE");
  });

  it("is decided by the visit time alone, and only for visit-bound rows", () => {
    const done = {
      type: "UNCONFIRMED_24H",
      status: "DONE",
      payload: unconfirmed,
      outcome: "RESCHEDULED",
      doneAt: T0,
    };
    const later = new Date(T0.getTime() + graceMs + MIN);
    expect(rescheduleNeverHappened(done, unconfirmed, later)).toBe(true);
    // Inside the grace, or after a real move: not abandoned.
    expect(rescheduleNeverHappened(done, unconfirmed, new Date(T0.getTime() + graceMs))).toBe(false);
    expect(
      rescheduleNeverHappened(done, { ...unconfirmed, appointmentAt: "2026-09-29T06:00:00.000Z" }, later),
    ).toBe(false);
    // A «Готово» without an outcome, or a DISMISSED row, is a person's decision.
    expect(rescheduleNeverHappened({ ...done, outcome: null }, unconfirmed, later)).toBe(false);
    expect(rescheduleNeverHappened({ ...done, status: "DISMISSED" }, unconfirmed, later)).toBe(false);
    // Not a visit-bound type.
    expect(
      rescheduleNeverHappened({ ...done, type: debt.type, payload: debt }, debt, later),
    ).toBe(false);
  });
});

describe("event-driven tasks", () => {
  const followUp: ActionPayload = {
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn_1",
    patientId: "p_1",
    patientName: "Иванова Мария",
    doctorId: "doc_1",
    doctorName: "Султанов А.",
    dueDate: "2026-10-05",
    followUpNote: "",
  };

  it("editing the note after the control-visit call was closed does not reopen it", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", followUp, {
      surfaceAt: new Date(T0.getTime() - HOUR),
    });
    close(store, id, "DONE");

    // Three days later the doctor fixes a typo in the conclusion; the bridge
    // re-runs with the same due date (and the same surface time).
    vi.setSystemTime(T0.getTime() + 3 * DAY);
    const res = await upsertAction(store.prisma, "c1", followUp, {
      surfaceAt: new Date(T0.getTime() - HOUR),
    });
    expect(res.keptClosed).toBe(true);
    const row = store.rows.get(id)!;
    expect(row.status).toBe("DONE");
    expect(row.snoozeUntil).toBeNull();
  });

  it("a moved control date is a new task and is scheduled again", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", followUp);
    close(store, id, "DONE");
    const surfaceAt = new Date(T0.getTime() + 20 * DAY);
    await upsertAction(
      store.prisma,
      "c1",
      { ...followUp, dueDate: "2026-10-25" },
      { surfaceAt },
    );
    const row = store.rows.get(id)!;
    expect(row.status).toBe("SNOOZED");
    expect(row.snoozeUntil).toEqual(surfaceAt);
  });

  it("a second missed reminder of the same day does not reopen PATIENT_NO_CHANNEL", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const noChannel: ActionPayload = {
      type: "PATIENT_NO_CHANNEL",
      patientId: "p_1",
      patientName: "Иванова Мария",
      triggerKey: "appointment.reminder-2h",
      appointmentId: "ap_1",
      appointmentAt: "2026-09-28T10:00:00.000Z",
      bucket: "2026-09-28",
    };
    const { id } = await upsertAction(store.prisma, "c1", noChannel);
    close(store, id, "DONE");
    vi.setSystemTime(T0.getTime() + 2 * HOUR);
    await upsertAction(store.prisma, "c1", noChannel);
    expect(store.rows.get(id)!.status).toBe("DONE");
  });

  it("an event row is never reopened by a gap alone, however long", () => {
    const conflict: ActionPayload = {
      type: "TELEGRAM_LINK_CONFLICT",
      telegramCardId: "a",
      telegramCardName: "A",
      clinicCardId: "b",
      clinicCardName: "B",
      via: "contact",
    };
    const row = {
      type: conflict.type,
      payload: conflict,
      updatedAt: new Date(T0.getTime() - 30 * DAY),
    };
    expect(closedRowReopens(row, { ...conflict, via: "invite" }, T0)).toBe(false);
  });
});

describe("actionSubjectOf", () => {
  it("ignores drifting readings and names what a person must act on", () => {
    expect(actionSubjectOf(debt)).toBe(actionSubjectOf({ ...debt, daysOverdue: 40 }));
    expect(actionSubjectOf(debt)).not.toBe(actionSubjectOf({ ...debt, amountUzs: 1 }));
    const risk: ActionPayload = {
      type: "NO_SHOW_RISK_HIGH",
      appointmentId: "ap_1",
      patientId: "p_1",
      patientName: "x",
      risk: 0.67,
      appointmentAt: "2026-09-28T10:00:00.000Z",
    };
    expect(actionSubjectOf(risk)).toBe(actionSubjectOf({ ...risk, risk: 0.75 }));
    expect(actionSubjectOf(risk)).not.toBe(
      actionSubjectOf({ ...risk, appointmentAt: "2026-09-28T11:00:00.000Z" }),
    );
  });
});
