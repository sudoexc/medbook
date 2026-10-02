/**
 * Notification content and triggers (P5 group notifications-content), run
 * against in-memory tables:
 *
 *   TG-21  a second reschedule notifies again and rebuilds the bands of the
 *          new start, even where the old start's band was already SENT; a
 *          move back to a start an earlier notice named notifies too; an
 *          unsent «перенесён» is voided by the next move;
 *   TG-18  the cascade top-up (`appointment.updated`) cancels reminders still
 *          queued for another start;
 *   TG-22  the template a trigger sends is deterministic (most recently
 *          edited first) and a staff cancellation prefers its own audience;
 *   TG-23  the referral reward speaks the referrer's language and names the
 *          clinic;
 *   INF-11 an EMAIL template makes no row (no adapter, no e-mail on file);
 *   P1D-01 a relative without Telegram is reminded through the family owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  appts: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
  family: [] as Array<Record<string, unknown>>,
  patients: [] as Array<Record<string, unknown>>,
  clinics: [] as Array<Record<string, unknown>>,
  rewards: [] as Array<Record<string, unknown>>,
  noChannel: [] as Array<Record<string, unknown>>,
  seq: 0,
}));

// ── a where-evaluator for the shapes these paths use ───────────────────────

function cmp(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v ?? null;
}

function matchField(actual: unknown, expected: unknown, row: Row, key: string): boolean {
  if (expected === null || typeof expected !== "object" || expected instanceof Date) {
    return cmp(actual) === cmp(expected);
  }
  const e = expected as Record<string, unknown>;
  if ("path" in e) {
    const cfg = (actual ?? {}) as Record<string, unknown>;
    return cfg[(e.path as string[])[0]!] === e.equals;
  }
  if ("equals" in e) return JSON.stringify(actual ?? null) === JSON.stringify(e.equals);
  if ("in" in e) return (e.in as unknown[]).map(cmp).includes(cmp(actual));
  if ("not" in e) {
    if (e.not === null) return actual !== null && actual !== undefined;
    return cmp(actual) !== cmp(e.not);
  }
  if ("gt" in e || "gte" in e || "lt" in e || "lte" in e) {
    const a = cmp(actual) as number;
    if ("gt" in e && !(a > (cmp(e.gt) as number))) return false;
    if ("gte" in e && !(a >= (cmp(e.gte) as number))) return false;
    if ("lt" in e && !(a < (cmp(e.lt) as number))) return false;
    if ("lte" in e && !(a <= (cmp(e.lte) as number))) return false;
    return true;
  }
  // Relation filters.
  if (key === "template") {
    const tpl = db.templates.find((t) => t.id === row.templateId);
    return tpl ? matches(tpl, e) : false;
  }
  if (key === "ownerPatient") {
    const p = db.patients.find((x) => x.id === row.ownerPatientId);
    return p ? matches(p, e) : false;
  }
  return false;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as Row[]).some((w) => matches(row, w));
    if (k === "AND") return (v as Row[]).every((w) => matches(row, w));
    if (k === "NOT") return !matches(row, v as Row);
    return matchField(row[k], v, row, k);
  });
}

function ordered<T extends Row>(rows: T[], orderBy: unknown): T[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of list as Array<Record<string, "asc" | "desc">>) {
      const [k, dir] = Object.entries(o)[0]!;
      const x = cmp(a[k]) as number | string;
      const y = cmp(b[k]) as number | string;
      if (x === y) continue;
      return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}

function withRefs(a: Row): Row {
  const patient = db.patients.find((p) => p.id === a.patientId)!;
  const clinic = db.clinics.find((c) => c.id === a.clinicId)!;
  return {
    ...a,
    patient,
    clinic,
    doctor: { nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz" },
    primaryService: null,
    cabinet: null,
  };
}

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async (p: Record<string, unknown>) => {
    db.noChannel.push(p);
  }),
}));
vi.mock("@/server/notifications/consent-gate", () => ({
  isAllowedToReceive: () => ({ allowed: true }),
}));

vi.mock("@/lib/prisma", () => {
  const insert = (data: Row) => {
    db.seq += 1;
    const row = { id: `snd_${db.seq}`, createdAt: new Date(), ...data };
    db.sends.push(row);
    return row;
  };
  return {
    prisma: {
      appointment: {
        findUnique: vi.fn(async ({ where, include }: { where: Row; include?: unknown }) => {
          const a = db.appts.find((x) => x.id === where.id);
          if (!a) return null;
          return include ? withRefs(a) : a;
        }),
        findMany: vi.fn(async ({ where }: { where: Row }) =>
          db.appts.filter((a) => matches(a, where)).map(withRefs),
        ),
      },
      notificationTemplate: {
        findFirst: vi.fn(async ({ where, orderBy }: { where: Row; orderBy?: unknown }) =>
          ordered(db.templates.filter((t) => matches(t, where)), orderBy)[0] ?? null,
        ),
        findMany: vi.fn(async ({ where, orderBy }: { where: Row; orderBy?: unknown }) =>
          ordered(db.templates.filter((t) => matches(t, where)), orderBy),
        ),
      },
      notificationSend: {
        findFirst: vi.fn(async ({ where, orderBy }: { where: Row; orderBy?: unknown }) =>
          ordered(db.sends.filter((s) => matches(s, where)), orderBy)[0] ?? null,
        ),
        findMany: vi.fn(async ({ where }: { where: Row }) =>
          db.sends.filter((s) => matches(s, where)),
        ),
        create: vi.fn(async ({ data }: { data: Row }) => insert(data)),
        createMany: vi.fn(async ({ data }: { data: Row[] }) => {
          data.forEach(insert);
          return { count: data.length };
        }),
        createManyAndReturn: vi.fn(async ({ data }: { data: Row[] }) => data.map(insert)),
        updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
          let count = 0;
          for (const s of db.sends) {
            if (!matches(s, where)) continue;
            Object.assign(s, data);
            count += 1;
          }
          return { count };
        }),
      },
      patientFamily: {
        findMany: vi.fn(async ({ where, orderBy }: { where: Row; orderBy?: unknown }) =>
          ordered(db.family.filter((f) => matches(f, where)), orderBy).map((f) => ({
            ...f,
            ownerPatient: db.patients.find((p) => p.id === f.ownerPatientId),
          })),
        ),
        findFirst: vi.fn(
          async ({ where }: { where: Row }) => db.family.find((f) => matches(f, where)) ?? null,
        ),
      },
      patient: {
        findFirst: vi.fn(async ({ where }: { where: Row }) =>
          db.patients.find((p) => matches(p, where)) ?? null,
        ),
      },
      clinic: {
        findUnique: vi.fn(async ({ where }: { where: Row }) =>
          db.clinics.find((c) => c.id === where.id) ?? null,
        ),
      },
      referralReward: {
        findFirst: vi.fn(async () => db.rewards[0] ?? null),
      },
    },
  };
});

// ── fixtures ────────────────────────────────────────────────────────────────

const CLINIC = {
  id: "c1",
  nameRu: "НейроФакс",
  nameUz: "NeuroFax",
  phone: "+998712000000",
  addressRu: "Ташкент",
  addressUz: "Toshkent",
  timezone: "Asia/Tashkent",
};

/** 2026-10-01 10:00 Tashkent. */
const NOW = new Date("2026-10-01T05:00:00.000Z");
const DAY = 24 * 3_600_000;
/** Monday 12 Oct 10:00, then Tuesday 13 Oct 12:00, then Wednesday 14 Oct 15:00. */
const MON = new Date("2026-10-12T05:00:00.000Z");
const TUE = new Date("2026-10-13T07:00:00.000Z");
const WED = new Date("2026-10-14T10:00:00.000Z");

function patient(over: Row = {}): Row {
  return {
    id: "p1",
    clinicId: "c1",
    fullName: "Каримов Азиз",
    phone: "+998901112233",
    telegramId: "tg_p1",
    tgBlockedAt: null,
    deletedAt: null,
    preferredChannel: "TG",
    preferredLang: "RU",
    birthDate: null,
    ...over,
  };
}

function tpl(id: string, over: Row): Row {
  return {
    id,
    clinicId: "c1",
    key: id,
    channel: "TG",
    isActive: true,
    bodyRu: "x",
    bodyUz: "",
    triggerConfig: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

function cascade(): Row[] {
  return [
    tpl("tpl_5d", { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -7200 }, bodyRu: "5д {{appointment.date}} {{appointment.time}}" }),
    tpl("tpl_24h", { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 }, bodyRu: "Завтра в {{appointment.time}}" }),
    tpl("tpl_3h", { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -180 }, bodyRu: "Через 3 часа в {{appointment.time}}" }),
    tpl("tpl_resched", {
      trigger: "APPOINTMENT_RESCHEDULED",
      bodyRu: "{{patient.firstName}}, приём перенесён на {{appointment.date}} в {{appointment.time}}",
      bodyUz: "{{patient.firstName}}, qabul {{appointment.date}} {{appointment.time}} ga ko'chirildi",
    }),
  ];
}

function appt(over: Row = {}): Row {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    date: MON,
    time: null,
    endDate: new Date(MON.getTime() + 30 * 60_000),
    status: "BOOKED",
    confirmedAt: null,
    ...over,
  };
}

const tg = (filter: (s: Row) => boolean = () => true) =>
  db.sends.filter((s) => s.channel === "TG" && filter(s));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.appts = [appt()];
  db.templates = cascade();
  db.sends = [];
  db.family = [];
  db.patients = [patient()];
  db.clinics = [CLINIC];
  db.rewards = [];
  db.noChannel = [];
  db.seq = 0;
});

async function moveTo(start: Date) {
  const { onAppointmentRescheduled } = await import("@/server/notifications/triggers");
  // Each move is its own event, minutes apart: rows of two moves never share
  // a `createdAt`.
  vi.advanceTimersByTime(60_000);
  db.appts[0]!.date = start;
  await onAppointmentRescheduled("apt_1");
}

function markAllSent() {
  for (const s of db.sends) if (s.status === "QUEUED") s.status = "SENT";
}

// ── TG-21 ───────────────────────────────────────────────────────────────────

describe("rescheduling twice (TG-21)", () => {
  it("notifies about each move, with the new time in each body", async () => {
    await moveTo(TUE);
    markAllSent();
    await moveTo(WED);

    const notices = tg((s) => s.templateId === "tpl_resched");
    expect(notices).toHaveLength(2);
    expect(notices[0]!.body).toContain("13 октября");
    expect(notices[0]!.body).toContain("12:00");
    expect(notices[1]!.body).toContain("14 октября");
    expect(notices[1]!.body).toContain("15:00");
    expect(notices[1]!.appointmentAt).toEqual(WED);
  });

  it("rebuilds the 24h and 3h bands of the new start although the old ones were SENT", async () => {
    await moveTo(TUE);
    markAllSent();
    await moveTo(WED);

    for (const [id, offset] of [
      ["tpl_24h", -1440],
      ["tpl_3h", -180],
    ] as const) {
      const fresh = tg((s) => s.templateId === id && s.status === "QUEUED");
      expect(fresh, id).toHaveLength(1);
      expect(fresh[0]!.scheduledFor).toEqual(new Date(WED.getTime() + offset * 60_000));
    }
  });

  it("notifies a move back to a start an earlier notice named (Mon → Tue → Wed → Tue)", async () => {
    await moveTo(TUE);
    markAllSent();
    await moveTo(WED);
    markAllSent();
    await moveTo(TUE);

    const notices = tg((s) => s.templateId === "tpl_resched");
    expect(notices.map((n) => n.appointmentAt)).toEqual([TUE, WED, TUE]);
    expect(notices[2]!.status).toBe("QUEUED");
    expect(notices[2]!.body).toContain("13 октября");
    expect(notices[2]!.body).toContain("12:00");
  });

  it("notifies the fourth move of Mon → Tue → Mon → Tue", async () => {
    await moveTo(TUE);
    markAllSent();
    await moveTo(MON);
    markAllSent();
    await moveTo(TUE);

    const notices = tg((s) => s.templateId === "tpl_resched");
    expect(notices.map((n) => n.appointmentAt)).toEqual([TUE, MON, TUE]);
    expect(notices[2]!.status).toBe("QUEUED");
  });

  it("still sends one notice when the same move fires twice after the first went out", async () => {
    await moveTo(TUE);
    markAllSent();
    await moveTo(TUE);
    expect(tg((s) => s.templateId === "tpl_resched")).toHaveLength(1);
  });

  it("counts a notice of a template switched off since for the same move", async () => {
    await moveTo(TUE);
    markAllSent();
    db.templates.find((t) => t.id === "tpl_resched")!.isActive = false;
    db.templates.push(
      tpl("tpl_resched_2", {
        trigger: "APPOINTMENT_RESCHEDULED",
        bodyRu: "Новое время: {{appointment.date}} {{appointment.time}}",
      }),
    );
    await moveTo(TUE);
    expect(tg((s) => String(s.templateId).startsWith("tpl_resched"))).toHaveLength(1);

    await moveTo(WED);
    expect(tg((s) => s.templateId === "tpl_resched_2")).toHaveLength(1);
  });

  it("voids an unsent notice about the previous move", async () => {
    await moveTo(TUE);
    await moveTo(WED);
    const first = tg((s) => s.templateId === "tpl_resched")[0]!;
    expect(first.status).toBe("CANCELLED");
    expect(tg((s) => s.templateId === "tpl_resched" && s.status === "QUEUED")).toHaveLength(1);
  });

  it("still never builds a band twice for the same start", async () => {
    const { scheduleAppointmentReminders } = await import("@/server/notifications/triggers");
    await scheduleAppointmentReminders("apt_1");
    const n = db.sends.length;
    await scheduleAppointmentReminders("apt_1");
    expect(db.sends.length).toBe(n);
  });

  it("counts a legacy band row (no stamped start) for the start it was derived from", async () => {
    const { scheduleAppointmentReminders } = await import("@/server/notifications/triggers");
    db.sends.push({
      id: "legacy",
      clinicId: "c1",
      patientId: "p1",
      appointmentId: "apt_1",
      appointmentAt: null,
      templateId: "tpl_24h",
      channel: "TG",
      status: "SENT",
      scheduledFor: new Date(MON.getTime() - DAY),
    });
    await scheduleAppointmentReminders("apt_1");
    expect(tg((s) => s.templateId === "tpl_24h")).toHaveLength(1);
  });

  it("the tick's band pass builds the new start's band past an old SENT one", async () => {
    const { materializeForAppointmentsBulk } = await import("@/server/notifications/triggers");
    db.sends.push({
      id: "old24",
      clinicId: "c1",
      patientId: "p1",
      appointmentId: "apt_1",
      appointmentAt: MON,
      templateId: "tpl_24h",
      channel: "TG",
      status: "SENT",
      scheduledFor: new Date(MON.getTime() - DAY),
    });
    db.appts[0]!.date = WED;
    const res = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_1", scheduledFor: new Date(WED.getTime() - DAY) }],
      "appointment.reminder-24h",
    );
    expect(res.created).toBeGreaterThan(0);

    const again = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_1", scheduledFor: new Date(WED.getTime() - DAY) }],
      "appointment.reminder-24h",
    );
    expect(again.created).toBe(0);
  });
});

// ── TG-18 ───────────────────────────────────────────────────────────────────

describe("cascade top-up after a move (TG-18)", () => {
  it("cancels reminders queued for the old start and builds the new ones", async () => {
    const { scheduleAppointmentReminders } = await import("@/server/notifications/triggers");
    await scheduleAppointmentReminders("apt_1");
    const old = db.sends.map((s) => s.id);
    db.appts[0]!.date = WED;
    await scheduleAppointmentReminders("apt_1");

    for (const id of old) {
      const row = db.sends.find((s) => s.id === id)!;
      expect(row.status, String(row.templateId)).toBe("CANCELLED");
    }
    const fresh = tg((s) => s.status === "QUEUED");
    expect(fresh.map((s) => s.templateId).sort()).toEqual(["tpl_24h", "tpl_3h", "tpl_5d"]);
    for (const s of fresh) expect(s.appointmentAt).toEqual(WED);
  });
});

// ── TG-22 ───────────────────────────────────────────────────────────────────

describe("which template a trigger sends (TG-22)", () => {
  it("the most recently edited of two active templates, every time", async () => {
    const { findActiveTemplateFor } = await import("@/server/notifications/triggers");
    db.templates = [
      tpl("reminder.24h", {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -1440 },
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
      tpl("appointment.reminder-24h", {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -1440 },
        updatedAt: new Date("2026-09-20T00:00:00.000Z"),
      }),
    ];
    for (let i = 0; i < 3; i += 1) {
      expect((await findActiveTemplateFor("c1", "appointment.reminder-24h"))?.key).toBe(
        "appointment.reminder-24h",
      );
    }
  });

  it("a staff cancellation takes the staff template before a generic one", async () => {
    const { findActiveTemplateFor } = await import("@/server/notifications/triggers");
    db.templates = [
      tpl("generic", {
        trigger: "APPOINTMENT_CANCELLED",
        triggerConfig: { audience: "any" },
        updatedAt: new Date("2026-09-30T00:00:00.000Z"),
      }),
      tpl("staff", {
        trigger: "APPOINTMENT_CANCELLED",
        triggerConfig: { audience: "staff" },
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ];
    expect((await findActiveTemplateFor("c1", "appointment.cancelled.by-staff"))?.key).toBe("staff");
    // No patient-audience template: the generic one stands in.
    expect((await findActiveTemplateFor("c1", "appointment.cancelled.by-patient"))?.key).toBe(
      "generic",
    );
  });
});

// ── INF-11: EMAIL ───────────────────────────────────────────────────────────

describe("an EMAIL template (INF-11)", () => {
  it("makes no row addressed to the phone", async () => {
    const { onAppointmentCreated } = await import("@/server/notifications/triggers");
    db.templates = [tpl("created", { trigger: "APPOINTMENT_CREATED", channel: "EMAIL" })];
    await onAppointmentCreated("apt_1");
    expect(db.sends).toEqual([]);
  });
});

// ── TG-23: referral ─────────────────────────────────────────────────────────

describe("referral reward (TG-23)", () => {
  it("is written in the referrer's language and names the clinic", async () => {
    const { fireTrigger } = await import("@/server/notifications/triggers");
    db.patients = [patient({ preferredLang: "UZ", marketingOptOut: false })];
    db.rewards = [{ rewardPercent: 15, referredPatient: { fullName: "Aliyev Vali" } }];
    db.templates = [
      tpl("referral.reward-earned", {
        trigger: "MANUAL",
        bodyRu: "{{patient.firstName}}, скидка {{percent}}% в {{clinic.name}}",
        bodyUz: "{{patient.firstName}}, {{clinic.name}} da {{percent}}% chegirma",
      }),
    ];
    fireTrigger({ kind: "referral.reward-earned", clinicId: "c1", patientId: "p1", rewardId: "r1" });
    await vi.waitFor(() => expect(db.sends.length).toBeGreaterThan(0));
    const row = tg()[0]!;
    expect(row.body).toBe("Азиз, NeuroFax da 15% chegirma");
  });
});

// ── P1D-01 ──────────────────────────────────────────────────────────────────

describe("a relative without Telegram (P1D-01)", () => {
  beforeEach(() => {
    db.patients = [
      patient({ id: "child", fullName: "Каримова Мадина", telegramId: null }),
      patient({ id: "mom", fullName: "Каримова Дилноза", telegramId: "tg_mom", preferredLang: "UZ" }),
    ];
    db.appts = [appt({ patientId: "child" })];
    db.family = [
      {
        id: "f1",
        clinicId: "c1",
        ownerPatientId: "mom",
        linkedPatientId: "child",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
  });

  it("gets the reminder through the family owner, in the owner's language, named", async () => {
    const { scheduleAppointmentReminders } = await import("@/server/notifications/triggers");
    db.templates = cascade().map((t) => ({ ...t, bodyUz: `UZ ${t.bodyRu}` }));
    await scheduleAppointmentReminders("apt_1");

    const rows = tg();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.recipient).toBe("tg_mom");
      // Still the child's visit and the child's row.
      expect(r.patientId).toBe("child");
      expect(String(r.body).startsWith("👤 Oila a'zosi: Каримова Мадина\n\n")).toBe(true);
      expect(String(r.body)).toContain("UZ ");
    }
    // The child cannot open the Mini App: no in-app mirror, no call task.
    expect(db.sends.filter((s) => s.channel === "INAPP")).toEqual([]);
    expect(db.noChannel).toEqual([]);
  });

  it("the tick's band pass relays too", async () => {
    const { materializeForAppointmentsBulk } = await import("@/server/notifications/triggers");
    const res = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_1", scheduledFor: new Date(MON.getTime() - DAY) }],
      "appointment.reminder-24h",
    );
    expect(res.created).toBe(1);
    expect(tg()[0]!.recipient).toBe("tg_mom");
  });

  it("falls back to the call task when no family member can be reached", async () => {
    const { scheduleAppointmentReminders } = await import("@/server/notifications/triggers");
    db.patients[1]!.tgBlockedAt = new Date();
    await scheduleAppointmentReminders("apt_1");
    expect(db.sends).toEqual([]);
    expect(db.noChannel.length).toBeGreaterThan(0);
  });

  it("is not used for the Mini App questionnaire (the link opens for the patient only)", async () => {
    const { onPreVisitQuestionnaire } = await import("@/server/notifications/triggers");
    db.templates = [tpl("appointment.pre-visit-questionnaire", { trigger: "CRON" })];
    const outcome = await onPreVisitQuestionnaire("apt_1");
    expect(outcome.reason).toBe("no_recipient");
    expect(db.sends).toEqual([]);
  });

  it("the owner may confirm the relative's visit with the button; a stranger may not", async () => {
    const { telegramUserMayConfirm } = await import("@/server/notifications/family-relay");
    const base = { clinicId: "c1", patientId: "child", patientTelegramId: null };
    expect(await telegramUserMayConfirm({ ...base, senderTelegramId: "tg_mom" })).toBe(true);
    expect(await telegramUserMayConfirm({ ...base, senderTelegramId: "tg_stranger" })).toBe(false);
    expect(await telegramUserMayConfirm({ ...base, senderTelegramId: null })).toBe(false);
  });
});
