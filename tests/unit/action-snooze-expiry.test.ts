/**
 * Audit AC-01 / AC-03 — tasks must not vanish behind the user's back.
 *
 *   AC-01 «Отложить» was a silent delete: every work list asked for OPEN only,
 *         so a SNOOZED row never came back; the 48h sweep also expired a row
 *         snoozed for a week; and the «Завтра» preset meant 14:00 Tashkent.
 *   AC-03 Event-driven tasks (control visit, low NPS) are written once and
 *         never refreshed, so the 48h `updatedAt` sweep erased them two days
 *         after creation, weeks before the control date. Review: the fix was
 *         per emitter, so TELEGRAM_LINK_CONFLICT (no expiresAt) still vanished
 *         over a weekend; the sweep is now scoped to the engine's own types.
 *   Order Rows record when they (re)became actionable (`surfacedAt`), which
 *         the work lists order by.
 *
 * `upsertAction` / `expireStaleActions` take `prisma` as a parameter, so an
 * in-memory stub that evaluates the Prisma `where` subset they use is enough
 * to replay the engine's 15-minute sweep over several simulated days.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACTIONABLE_STATUSES,
  ACTION_TYPES,
  DETECTOR_ACTION_TYPES,
  type ActionPayload,
} from "@/lib/actions/types";
import { resolveSnoozePreset } from "@/server/actions/handler-utils";
import { clinicMorningBefore, nextClinicMorning } from "@/server/actions/clinic-day";
import { expireStaleActions, upsertAction } from "@/server/actions/repository";
import {
  VISIT_FOLLOW_UP_GRACE_DAYS,
  VISIT_FOLLOW_UP_LEAD_DAYS,
} from "@/server/actions/config";

// ── in-memory Action store ───────────────────────────────────────────────────

type Row = {
  id: string;
  clinicId: string;
  type: string;
  severity: string;
  payload: unknown;
  status: string;
  assigneeRole: string | null;
  deeplinkPath: string | null;
  dedupeKey: string;
  snoozeUntil: Date | null;
  dismissedAt: Date | null;
  doneAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
  surfacedAt?: Date;
  branchId: string | null;
};

type Where = Record<string, unknown>;

/** Evaluates the Prisma where-subset the repository uses. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
    if (key === "AND") return (cond as Where[]).every((w) => matches(row, w));
    const v = row[key];
    if (cond === null) return v === null;
    if (cond instanceof Date || typeof cond !== "object") {
      return v instanceof Date && cond instanceof Date
        ? v.getTime() === cond.getTime()
        : v === cond;
    }
    const c = cond as { in?: unknown[]; lte?: Date; gt?: Date };
    if (c.in) return c.in.includes(v);
    if (c.lte) return v instanceof Date && v.getTime() <= c.lte.getTime();
    if (c.gt) return v instanceof Date && v.getTime() > c.gt.getTime();
    throw new Error(`unsupported condition on ${key}`);
  });
}

function makeStore() {
  const rows = new Map<string, Row>();
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
      create: async ({ data }: { data: Partial<Row> }) => {
        const row = {
          id: `act_${++seq}`,
          snoozeUntil: null,
          dismissedAt: null,
          doneAt: null,
          branchId: null,
          ...data,
          updatedAt: new Date(),
        } as Row;
        rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = { ...rows.get(where.id)!, ...data, updatedAt: new Date() };
        rows.set(row.id, row);
        return row;
      },
      findMany: async ({ where }: { where: Where }) =>
        [...rows.values()].filter((r) => matches(r as never, where)),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: Partial<Row>;
      }) => {
        for (const id of where.id.in) {
          rows.set(id, { ...rows.get(id)!, ...data, updatedAt: new Date() });
        }
        return { count: where.id.in.length };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  return { rows, prisma: prisma as unknown as Parameters<typeof upsertAction>[0] };
}

/** A row as the engine would leave it, `updatedAt` pinned in the past. */
function seed(store: ReturnType<typeof makeStore>, over: Partial<Row>): Row {
  const row: Row = {
    id: over.id ?? "act_seed",
    clinicId: "c1",
    type: "PAYMENT_OVERDUE",
    severity: "critical",
    payload: {},
    status: "OPEN",
    assigneeRole: "RECEPTIONIST",
    deeplinkPath: null,
    dedupeKey: over.id ?? "act_seed",
    snoozeUntil: null,
    dismissedAt: null,
    doneAt: null,
    expiresAt: null,
    updatedAt: new Date(),
    branchId: null,
    ...over,
  };
  store.rows.set(row.id, row);
  return row;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterEach(() => {
  vi.useRealTimers();
});

// ── AC-01 ────────────────────────────────────────────────────────────────────

describe("snooze preset «Завтра» (Asia/Tashkent)", () => {
  it("is 09:00 of the next clinic day, i.e. 04:00Z", () => {
    // 15:00 Tashkent on 25 Sep.
    const at = resolveSnoozePreset("tomorrow", new Date("2026-09-25T10:00:00.000Z"));
    expect(at.toISOString()).toBe("2026-09-26T04:00:00.000Z");
  });

  it("follows the clinic calendar across UTC midnight", () => {
    // 23:30 Tashkent on 25 Sep (18:30Z): still the 25th locally.
    expect(
      resolveSnoozePreset("tomorrow", new Date("2026-09-25T18:30:00.000Z")).toISOString(),
    ).toBe("2026-09-26T04:00:00.000Z");
    // 01:30 Tashkent on 26 Sep (20:30Z on the 25th): tomorrow is the 27th.
    // The old UTC arithmetic answered 26 Sep 14:00, the same clinic day.
    expect(
      resolveSnoozePreset("tomorrow", new Date("2026-09-25T20:30:00.000Z")).toISOString(),
    ).toBe("2026-09-27T04:00:00.000Z");
  });

  it("keeps the relative presets relative", () => {
    const now = new Date("2026-09-25T10:00:00.000Z");
    expect(resolveSnoozePreset("1h", now).getTime() - now.getTime()).toBe(HOUR);
    expect(resolveSnoozePreset("4h", now).getTime() - now.getTime()).toBe(4 * HOUR);
    expect(nextClinicMorning(now).toISOString()).toBe("2026-09-26T04:00:00.000Z");
  });
});

describe("expireStaleActions", () => {
  const NOW = new Date("2026-09-25T10:00:00.000Z");

  it("still expires a detector row nobody refreshed for 48h", async () => {
    vi.useFakeTimers({ now: NOW });
    const store = makeStore();
    seed(store, { id: "stale", updatedAt: new Date(NOW.getTime() - 3 * DAY) });
    seed(store, { id: "fresh", updatedAt: new Date(NOW.getTime() - HOUR) });
    expect(await expireStaleActions(store.prisma, "c1")).toBe(1);
    expect(store.rows.get("stale")!.status).toBe("EXPIRED");
    expect(store.rows.get("fresh")!.status).toBe("OPEN");
  });

  it("does not expire a row snoozed into the future, however old its refresh", async () => {
    vi.useFakeTimers({ now: NOW });
    const store = makeStore();
    seed(store, {
      id: "week",
      status: "SNOOZED",
      updatedAt: new Date(NOW.getTime() - 3 * DAY),
      snoozeUntil: new Date(NOW.getTime() + 4 * DAY),
    });
    expect(await expireStaleActions(store.prisma, "c1")).toBe(0);
    expect(store.rows.get("week")!.status).toBe("SNOOZED");
  });

  it("counts the TTL from the snooze end once it has passed", async () => {
    vi.useFakeTimers({ now: NOW });
    const store = makeStore();
    seed(store, {
      id: "resurfaced",
      status: "SNOOZED",
      updatedAt: new Date(NOW.getTime() - 9 * DAY),
      snoozeUntil: new Date(NOW.getTime() - 1 * DAY),
    });
    seed(store, {
      id: "long-gone",
      status: "SNOOZED",
      updatedAt: new Date(NOW.getTime() - 9 * DAY),
      snoozeUntil: new Date(NOW.getTime() - 3 * DAY),
    });
    expect(await expireStaleActions(store.prisma, "c1")).toBe(1);
    expect(store.rows.get("resurfaced")!.status).toBe("SNOOZED");
    expect(store.rows.get("long-gone")!.status).toBe("EXPIRED");
  });

  // AC-03 acceptance: a row with a future expiresAt and an old updatedAt
  // is left alone; the explicit deadline alone decides.
  it("leaves a row with a future expiresAt alone, and expires it once that passes", async () => {
    vi.useFakeTimers({ now: NOW });
    const store = makeStore();
    seed(store, {
      id: "nps",
      type: "LOW_NPS_RECEIVED",
      updatedAt: new Date(NOW.getTime() - 3 * DAY),
      expiresAt: new Date(NOW.getTime() + 11 * DAY),
    });
    seed(store, {
      id: "past-due",
      type: "NO_SHOW_RISK_HIGH",
      updatedAt: new Date(NOW.getTime() - HOUR),
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    expect(await expireStaleActions(store.prisma, "c1")).toBe(1);
    expect(store.rows.get("nps")!.status).toBe("OPEN");
    expect(store.rows.get("past-due")!.status).toBe("EXPIRED");
  });
});

// ── AC-03 review: the 48h sweep belongs to the engine's detectors only ───────

describe("expireStaleActions scope", () => {
  const NOW = new Date("2026-09-25T10:00:00.000Z");

  it("sweeps idle detector rows and leaves every write-once type alone", async () => {
    vi.useFakeTimers({ now: NOW });
    const store = makeStore();
    for (const type of ACTION_TYPES) {
      seed(store, { id: type, type, updatedAt: new Date(NOW.getTime() - 30 * DAY) });
    }
    await expireStaleActions(store.prisma, "c1");
    for (const type of ACTION_TYPES) {
      const detector = (DETECTOR_ACTION_TYPES as readonly string[]).includes(type);
      expect(store.rows.get(type)!.status, type).toBe(detector ? "EXPIRED" : "OPEN");
    }
  });

  it("keeps a Telegram card conflict raised on Friday evening through the weekend", async () => {
    // Friday 25 Sep, 18:00 Tashkent.
    const friday = new Date("2026-09-25T13:00:00.000Z");
    vi.useFakeTimers({ now: friday });
    const store = makeStore();
    // Exactly what raiseTelegramLinkConflict writes: no expiresAt.
    const { id } = await upsertAction(
      store.prisma,
      "c1",
      {
        type: "TELEGRAM_LINK_CONFLICT",
        telegramCardId: "p_tg",
        telegramCardName: "Каримова Н.",
        clinicCardId: "p_clinic",
        clinicCardName: "Каримова Нодира",
        via: "contact",
      },
      { deeplinkPath: "/crm/patients/p_clinic" },
    );
    // The engine sweeps every 15 minutes until Monday 09:00.
    const monday = new Date("2026-09-28T04:00:00.000Z");
    for (let t = friday.getTime(); t <= monday.getTime(); t += 15 * 60 * 1000) {
      vi.setSystemTime(t);
      await expireStaleActions(store.prisma, "c1");
    }
    expect(store.rows.get(id)!.status).toBe("OPEN");
  });

  it("the engine runs exactly the detector types the sweep covers", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/server/actions/engine.ts"),
      "utf8",
    );
    const specs = src.slice(src.indexOf("const specs: Spec[] = ["));
    const block = specs.slice(0, specs.indexOf("\n  ];"));
    const types = [...block.matchAll(/^ {6}type: "([A-Z0-9_]+)",$/gm)].map((m) => m[1]);
    expect(types.sort()).toEqual([...DETECTOR_ACTION_TYPES].sort());
    expect(src).toMatch(/type: DetectorActionType;/);
  });
});

// ── surfacedAt: when a row (re)became actionable ────────────────────────────

describe("upsertAction stamps surfacedAt", () => {
  const T0 = new Date("2026-09-25T06:00:00.000Z");
  const debt: ActionPayload = {
    type: "PAYMENT_OVERDUE",
    appointmentId: "ap_1",
    patientId: "p_1",
    patientName: "Каримов",
    amountUzs: 45_000_000,
    daysOverdue: 3,
  };

  it("at insert, or at the scheduled surface time", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const now = await upsertAction(store.prisma, "c1", debt);
    expect(store.rows.get(now.id)!.surfacedAt).toEqual(T0);

    const surfaceAt = new Date(T0.getTime() + 20 * DAY);
    const later = await upsertAction(
      store.prisma,
      "c1",
      { ...debt, appointmentId: "ap_2" },
      { surfaceAt },
    );
    expect(store.rows.get(later.id)!.surfacedAt).toEqual(surfaceAt);
  });

  it("keeps its place on a detector refresh, moves on a resurrection", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", debt);

    vi.setSystemTime(T0.getTime() + 6 * HOUR);
    await upsertAction(store.prisma, "c1", { ...debt, daysOverdue: 4 });
    expect(store.rows.get(id)!.surfacedAt).toEqual(T0);

    store.rows.get(id)!.status = "EXPIRED";
    const back = new Date(T0.getTime() + 3 * DAY);
    vi.setSystemTime(back);
    await upsertAction(store.prisma, "c1", debt);
    expect(store.rows.get(id)!.status).toBe("OPEN");
    expect(store.rows.get(id)!.surfacedAt).toEqual(back);
  });

  it("follows a re-schedule: pushed out, or brought forward from a live snooze", async () => {
    vi.useFakeTimers({ now: T0 });
    const store = makeStore();
    const followUp: ActionPayload = {
      type: "VISIT_FOLLOW_UP_DUE",
      visitNoteId: "vn_1",
      patientId: "p_1",
      patientName: "Иванова Мария",
      doctorId: "doc_1",
      doctorName: "Алиев А.А.",
      dueDate: "2026-10-25",
      followUpNote: "",
    };
    const first = new Date(T0.getTime() + 20 * DAY);
    const { id } = await upsertAction(store.prisma, "c1", followUp, { surfaceAt: first });

    const edited = new Date(T0.getTime() + 25 * DAY);
    await upsertAction(store.prisma, "c1", followUp, { surfaceAt: edited });
    expect(store.rows.get(id)!.surfacedAt).toEqual(edited);

    // The doctor shortens the interval: the call is due at once.
    vi.setSystemTime(T0.getTime() + HOUR);
    await upsertAction(store.prisma, "c1", followUp, {
      surfaceAt: new Date(T0.getTime() - DAY),
    });
    expect(store.rows.get(id)!.status).toBe("OPEN");
    expect(store.rows.get(id)!.surfacedAt).toEqual(new Date(T0.getTime() + HOUR));
  });
});

// ── AC-03: the control-visit task over its whole life ────────────────────────

describe("VISIT_FOLLOW_UP_DUE lifecycle under the 15-minute sweep", () => {
  const FINALIZED = new Date("2026-09-25T06:00:00.000Z"); // 11:00 Tashkent
  const DUE = new Date(FINALIZED.getTime() + 30 * DAY); // 25 Oct
  const DUE_DATE = "2026-10-25";

  const payload: ActionPayload = {
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn_1",
    patientId: "p_1",
    patientName: "Иванова Мария",
    doctorId: "doc_1",
    doctorName: "Алиев А.А.",
    dueDate: DUE_DATE,
    followUpNote: "",
  };

  /** What `/api/crm/actions` serves for status=OPEN+SNOOZED at `now`. */
  function visibleInList(row: Row, now: Date): boolean {
    return (
      ACTIONABLE_STATUSES.includes(row.status as never) &&
      (row.expiresAt === null || row.expiresAt > now) &&
      (row.snoozeUntil === null || row.snoozeUntil <= now)
    );
  }

  it("surfaces a week ahead of the due date and expires only after the grace week", async () => {
    vi.useFakeTimers({ now: FINALIZED });
    const store = makeStore();
    const surfaceAt = clinicMorningBefore(DUE_DATE, VISIT_FOLLOW_UP_LEAD_DAYS);
    // 18 Oct 09:00 Tashkent.
    expect(surfaceAt.toISOString()).toBe("2026-10-18T04:00:00.000Z");

    const { id } = await upsertAction(store.prisma, "c1", payload, {
      expiresAt: new Date(DUE.getTime() + VISIT_FOLLOW_UP_GRACE_DAYS * DAY),
      surfaceAt,
    });
    const row = () => store.rows.get(id)!;
    expect(row().status).toBe("SNOOZED");

    // Three days of engine ticks: the row survives the sweep untouched.
    for (let t = FINALIZED.getTime(); t <= FINALIZED.getTime() + 3 * DAY; t += 6 * HOUR) {
      vi.setSystemTime(t);
      await expireStaleActions(store.prisma, "c1");
    }
    expect(row().status).toBe("SNOOZED");
    expect(visibleInList(row(), new Date())).toBe(false);

    // On the lead day it is in the list (without any status flip).
    const leadDay = new Date(surfaceAt.getTime() + HOUR);
    vi.setSystemTime(leadDay);
    await expireStaleActions(store.prisma, "c1");
    expect(visibleInList(row(), leadDay)).toBe(true);

    // Still there on the due date and during the grace week.
    const graceEnd = DUE.getTime() + VISIT_FOLLOW_UP_GRACE_DAYS * DAY;
    vi.setSystemTime(graceEnd - HOUR);
    await expireStaleActions(store.prisma, "c1");
    expect(row().status).not.toBe("EXPIRED");

    // Gone only after due + 7 days.
    vi.setSystemTime(graceEnd + 60_000);
    await expireStaleActions(store.prisma, "c1");
    expect(row().status).toBe("EXPIRED");
  });

  it("shows a short follow-up at once", async () => {
    vi.useFakeTimers({ now: FINALIZED });
    const store = makeStore();
    const { id } = await upsertAction(
      store.prisma,
      "c1",
      { ...payload, dueDate: "2026-09-28" },
      { surfaceAt: clinicMorningBefore("2026-09-28", VISIT_FOLLOW_UP_LEAD_DAYS) },
    );
    expect(store.rows.get(id)!.status).toBe("OPEN");
    expect(store.rows.get(id)!.snoozeUntil).toBeNull();
  });

  it("re-schedules when the doctor edits the interval, without touching user snoozes elsewhere", async () => {
    vi.useFakeTimers({ now: FINALIZED });
    const store = makeStore();
    const { id } = await upsertAction(store.prisma, "c1", payload, {
      surfaceAt: clinicMorningBefore(DUE_DATE, VISIT_FOLLOW_UP_LEAD_DAYS),
    });
    // The doctor shortens the follow-up to 5 days inside the edit window.
    await upsertAction(
      store.prisma,
      "c1",
      { ...payload, dueDate: "2026-09-30" },
      { surfaceAt: clinicMorningBefore("2026-09-30", VISIT_FOLLOW_UP_LEAD_DAYS) },
    );
    expect(store.rows.get(id)!.status).toBe("OPEN");
    expect(store.rows.get(id)!.snoozeUntil).toBeNull();

    // A detector upsert (no surfaceAt) keeps a user-set snooze as is.
    const snoozed = seed(store, {
      id: "user-snoozed",
      type: "PAYMENT_OVERDUE",
      status: "SNOOZED",
      snoozeUntil: new Date(FINALIZED.getTime() + 2 * DAY),
      dedupeKey: "PAYMENT_OVERDUE:appointmentId=ap_9",
    });
    await upsertAction(store.prisma, "c1", {
      type: "PAYMENT_OVERDUE",
      appointmentId: "ap_9",
      patientId: "p_9",
      patientName: "Каримов",
      amountUzs: 45_000_000,
      daysOverdue: 3,
    });
    expect(store.rows.get(snoozed.id)!.status).toBe("SNOOZED");
    expect(store.rows.get(snoozed.id)!.snoozeUntil).toEqual(snoozed.snoozeUntil);
  });
});

// ── wiring: every work list asks for elapsed snoozes too ────────────────────

describe("Action work lists request OPEN + SNOOZED", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), "src/app/[locale]/crm", rel), "utf8");

  it("Action Center, reception briefing and the call-center widget", () => {
    expect(ACTIONABLE_STATUSES).toEqual(["OPEN", "SNOOZED"]);
    for (const rel of [
      "action-center/_components/action-center-client.tsx",
      "reception/_components/action-briefing.tsx",
      "call-center/_hooks/use-unconfirmed.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("ACTIONABLE_STATUSES");
      expect(src, rel).not.toMatch(/status:\s*\["OPEN"\]/);
      expect(src, rel).not.toMatch(/append\("status",\s*"OPEN"\)/);
    }
  });

  it("the row menu reports a failed snooze / dismiss instead of failing silently", () => {
    const src = read("action-center/_components/action-center-client.tsx");
    const menu = src.slice(src.indexOf("function ActionMenu("));
    const body = menu.slice(0, menu.indexOf("\n}\n"));
    expect(body).toMatch(/snooze\.mutateAsync[\s\S]*?catch[\s\S]*?snooze\.error/);
    expect(body).toMatch(/dismiss\.mutateAsync[\s\S]*?catch[\s\S]*?dismiss\.error/);
  });
});

describe("LOW_NPS_RECEIVED carries its own lifetime", () => {
  it("is upserted with an explicit expiresAt, so the 48h sweep cannot touch it", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/miniapp/nps/[appointmentId]/route.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /upsertAction\(prisma, ctx\.clinicId, payload, \{[\s\S]*?expiresAt:[\s\S]*?LOW_NPS_ALERT_TTL_DAYS/,
    );
  });
});
