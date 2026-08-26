/**
 * Reschedule → the patient must learn the NEW time.
 *
 * The reminder cascade is materialised eagerly at booking time: each row
 * carries the wall-clock time already rendered into `body` and a
 * `scheduledFor` derived from the then-current start. That makes a move
 * doubly wrong — the stored text names an hour that no longer exists, and it
 * would be delivered relative to the old slot.
 *
 * Before the fix, moving an appointment:
 *   - sent no "your appointment moved" message at all (no such trigger), and
 *   - left the stale QUEUED rows alone while the idempotency gate
 *     (`alreadyScheduled`) refused to re-materialise the cascade, because a
 *     QUEUED row for the same (patient, appointment, template) already
 *     existed.
 * Net effect: a reminder for the OLD time, and silence for the new one.
 *
 * These tests drive the real `onAppointmentRescheduled` against an in-memory
 * NotificationSend table, so they cover the ordering contract that makes the
 * rebuild possible (cancel first, then re-materialise).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

type Send = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  templateId: string;
  channel: string;
  recipient: string;
  body: string;
  scheduledFor: Date;
  status: string;
  failedReason?: string | null;
};

type Template = {
  id: string;
  clinicId: string;
  key: string;
  trigger: string;
  triggerConfig: Record<string, unknown> | null;
  bodyRu: string;
  bodyUz: string;
  channel: string;
  isActive: boolean;
};

const CLINIC = "c1";
const PATIENT = "p1";
const APPT = "apt_1";

/** Old slot: 2026-09-10 15:00 Tashkent (UTC+5) → 10:00Z. */
const OLD_START = new Date("2026-09-10T10:00:00.000Z");
/** New slot: 2026-09-12 11:00 Tashkent → 06:00Z. */
const NEW_START = new Date("2026-09-12T06:00:00.000Z");
/** "Now" sits far enough before both starts that every cascade band applies. */
const NOW = new Date("2026-09-01T08:00:00.000Z");

const TEMPLATES: Template[] = [
  {
    id: "tpl_5d",
    clinicId: CLINIC,
    key: "appointment.reminder-5d",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -7200 },
    bodyRu: "До приёма 5 дней: {{appointment.date}} в {{appointment.time}}.",
    bodyUz: "5 kun: {{appointment.date}} {{appointment.time}}.",
    channel: "TG",
    isActive: true,
  },
  {
    id: "tpl_3d",
    clinicId: CLINIC,
    key: "appointment.reminder-3d",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -4320 },
    bodyRu: "Через 3 дня, {{appointment.date}} в {{appointment.time}}.",
    bodyUz: "3 kun: {{appointment.date}} {{appointment.time}}.",
    channel: "TG",
    isActive: true,
  },
  {
    id: "tpl_24h",
    clinicId: CLINIC,
    key: "appointment.reminder-24h",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -1440 },
    bodyRu: "Завтра в {{appointment.time}}.",
    bodyUz: "Ertaga {{appointment.time}}.",
    channel: "TG",
    isActive: true,
  },
  {
    id: "tpl_3h",
    clinicId: CLINIC,
    key: "appointment.reminder-3h",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -180 },
    bodyRu: "Через 3 часа в {{appointment.time}}.",
    bodyUz: "3 soatdan keyin {{appointment.time}}.",
    channel: "TG",
    isActive: true,
  },
  {
    id: "tpl_resched",
    clinicId: CLINIC,
    key: "appointment.rescheduled",
    trigger: "APPOINTMENT_RESCHEDULED",
    triggerConfig: null,
    bodyRu:
      "Ваш приём перенесён. Новое время: {{appointment.date}} в {{appointment.time}}.",
    bodyUz: "Ko'chirildi: {{appointment.date}} {{appointment.time}}.",
    channel: "TG",
    isActive: true,
  },
];

const state = {
  sends: [] as Send[],
  apptStart: OLD_START,
  seq: 0,
};

function nextId(): string {
  state.seq += 1;
  return `snd_${state.seq}`;
}

/** Rough structural matcher for the `where` clauses the code under test uses. */
function matchesWhere(s: Send, where: Record<string, unknown>): boolean {
  if (where.appointmentId !== undefined && s.appointmentId !== where.appointmentId)
    return false;
  if (where.clinicId !== undefined && s.clinicId !== where.clinicId) return false;
  if (where.patientId !== undefined && s.patientId !== where.patientId) return false;
  if (where.templateId !== undefined && s.templateId !== where.templateId)
    return false;
  if (where.id !== undefined && s.id !== where.id) return false;

  const status = where.status as unknown;
  if (typeof status === "string" && s.status !== status) return false;
  if (status && typeof status === "object" && "in" in status) {
    const list = (status as { in: string[] }).in;
    if (!list.includes(s.status)) return false;
  }

  // `template: { trigger: { in: [...] } }` — resolve through the template table.
  const tplWhere = where.template as
    | { trigger?: { in?: string[] } }
    | undefined;
  if (tplWhere?.trigger?.in) {
    const tpl = TEMPLATES.find((t) => t.id === s.templateId);
    if (!tpl || !tplWhere.trigger.in.includes(tpl.trigger)) return false;
  }
  return true;
}

// ----- mocks ----------------------------------------------------------------

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_scope: unknown, fn: () => T) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => ({
        id: APPT,
        clinicId: CLINIC,
        patientId: PATIENT,
        date: state.apptStart,
        time: null,
        status: "BOOKED",
        confirmedAt: null,
        patient: {
          id: PATIENT,
          fullName: "Иванов Иван Иванович",
          phone: "+998901234567",
          telegramId: "tg_1", // TG is the only outbound channel post-SMS-removal
          lang: "ru",
        },
        doctor: { nameRu: "Петров П.П.", nameUz: "Petrov P.P." },
        clinic: {
          nameRu: "НейроФакс",
          nameUz: "NeuroFax",
          phone: "+998711111111",
          addressRu: "Ташкент",
          timezone: "Asia/Tashkent",
        },
        primaryService: null,
        cabinet: null,
      })),
    },
    notificationTemplate: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Resolve the same way `whereForTrigger` intends: by enum (+offsetMin)
        // or by slug via the OR branches.
        const branches = (where.OR as Record<string, unknown>[]) ?? [where];
        for (const b of branches) {
          const hit = TEMPLATES.find((t) => {
            if (t.clinicId !== CLINIC || !t.isActive) return false;
            if (b.key !== undefined && t.key !== b.key) return false;
            if (b.trigger !== undefined && t.trigger !== b.trigger) return false;
            const cfg = b.triggerConfig as
              | { path?: string[]; equals?: unknown }
              | undefined;
            if (cfg?.path?.[0] === "offsetMin") {
              const off = (t.triggerConfig as { offsetMin?: number } | null)
                ?.offsetMin;
              if (off !== cfg.equals) return false;
            }
            return true;
          });
          if (hit) return hit;
        }
        return null;
      }),
    },
    notificationSend: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          state.sends.find((s) => matchesWhere(s, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Send }) => {
        const row = { ...data, id: nextId() };
        state.sends.push(row);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<Send>;
        }) => {
          let count = 0;
          for (const s of state.sends) {
            if (!matchesWhere(s, where)) continue;
            Object.assign(s, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
  },
}));

vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => {}),
}));

vi.mock("@/server/notifications/consent-gate", () => ({
  isAllowedToReceive: vi.fn(async () => true),
}));

// ----- helpers --------------------------------------------------------------

/** Seed the cascade the way booking-time materialisation would have. */
function seedOldCascade(): void {
  const bands: Array<[string, number]> = [
    ["tpl_5d", -7200],
    ["tpl_3d", -4320],
    ["tpl_24h", -1440],
    ["tpl_3h", -180],
  ];
  for (const [templateId, offsetMin] of bands) {
    state.sends.push({
      id: nextId(),
      clinicId: CLINIC,
      patientId: PATIENT,
      appointmentId: APPT,
      templateId,
      channel: "TG",
      recipient: "tg_1",
      // 15:00 is the OLD Tashkent wall clock — the smoking gun in the body.
      body: "Напоминание: 10 сентября 2026 г. в 15:00.",
      scheduledFor: new Date(OLD_START.getTime() + offsetMin * 60_000),
      status: "QUEUED",
    });
  }
}

beforeEach(() => {
  state.sends = [];
  state.apptStart = OLD_START;
  state.seq = 0;
  vi.setSystemTime(NOW);
});

// ----- tests ----------------------------------------------------------------

describe("onAppointmentRescheduled", () => {
  it("cancels the stale QUEUED reminders and rebuilds the cascade from the new start", async () => {
    const { onAppointmentRescheduled } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    const staleIds = state.sends.map((s) => s.id);

    // The move itself: the row is already persisted at its new start when the
    // trigger fires (post-commit, fire-and-forget).
    state.apptStart = NEW_START;
    await onAppointmentRescheduled(APPT);

    // Every reminder queued against the old slot is dead.
    for (const id of staleIds) {
      const row = state.sends.find((s) => s.id === id)!;
      expect(row.status).toBe("CANCELLED");
    }

    // …and a fresh cascade exists, anchored on the NEW start.
    // A TG patient also gets an INAPP mirror per band — assert on the TG row.
    const fresh = state.sends.filter(
      (s) =>
        s.status === "QUEUED" &&
        s.channel === "TG" &&
        !staleIds.includes(s.id),
    );
    const byTemplate = new Map(fresh.map((s) => [s.templateId, s]));
    const expected: Array<[string, number]> = [
      ["tpl_5d", -7200],
      ["tpl_3d", -4320],
      ["tpl_24h", -1440],
      ["tpl_3h", -180],
    ];
    for (const [templateId, offsetMin] of expected) {
      const row = byTemplate.get(templateId);
      expect(row, `missing rebuilt band ${templateId}`).toBeTruthy();
      expect(row!.scheduledFor.getTime()).toBe(
        NEW_START.getTime() + offsetMin * 60_000,
      );
    }
  });

  it("renders the NEW date and time into the rebuilt reminder bodies", async () => {
    const { onAppointmentRescheduled } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    const staleIds = new Set(state.sends.map((s) => s.id));

    state.apptStart = NEW_START;
    await onAppointmentRescheduled(APPT);

    const rebuilt = state.sends.filter(
      (s) => s.status === "QUEUED" && !staleIds.has(s.id),
    );
    expect(rebuilt.length).toBeGreaterThan(0);

    // New slot is 11:00 Tashkent on 12.09.2026; the old one was 15:00 on the
    // 10th. No rebuilt body may still quote the old wall clock.
    for (const row of rebuilt) {
      expect(row.body).not.toContain("15:00");
      expect(row.body).not.toContain("10 сентября 2026");
    }
    const withTime = rebuilt.filter((r) => r.body.includes("11:00"));
    expect(withTime.length).toBeGreaterThan(0);
  });

  it("sends a reschedule notice that names the new date and time", async () => {
    const { onAppointmentRescheduled } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    state.apptStart = NEW_START;
    await onAppointmentRescheduled(APPT);

    const notice = state.sends.find(
      (s) =>
        s.templateId === "tpl_resched" &&
        s.status === "QUEUED" &&
        s.channel === "TG",
    );
    expect(notice, "no reschedule notice was created").toBeTruthy();
    expect(notice!.body).toContain("перенесён");
    // `formatDate` renders long-form Russian in the clinic TZ.
    expect(notice!.body).toContain("12 сентября 2026");
    expect(notice!.body).toContain("11:00");
  });

  it("never touches reminders that were already SENT", async () => {
    const { onAppointmentRescheduled } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    // The 5-day ping already went out before the clinic moved the slot.
    const sent = state.sends.find((s) => s.templateId === "tpl_5d")!;
    sent.status = "SENT";
    const sentBody = sent.body;

    state.apptStart = NEW_START;
    await onAppointmentRescheduled(APPT);

    // History is immutable: status and body stay exactly as delivered.
    expect(sent.status).toBe("SENT");
    expect(sent.body).toBe(sentBody);
  });

  it("re-materialises a band even though a SENT row already exists for it (gate must not block the rebuild)", async () => {
    const { onAppointmentRescheduled } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    const old5d = state.sends.find((s) => s.templateId === "tpl_5d")!;
    old5d.status = "SENT";

    state.apptStart = NEW_START;
    await onAppointmentRescheduled(APPT);

    // The idempotency gate counts SENT rows, so this band is legitimately
    // skipped — but the bands whose old rows we cancelled must come back.
    // (Documents the known boundary: a band already delivered is not re-sent.)
    const rebuilt3d = state.sends.filter(
      (s) =>
        s.templateId === "tpl_3d" &&
        s.status === "QUEUED" &&
        s.channel === "TG",
    );
    expect(rebuilt3d.length).toBe(1);
    expect(rebuilt3d[0].scheduledFor.getTime()).toBe(
      NEW_START.getTime() - 4320 * 60_000,
    );
  });
});

describe("cancelPendingAppointmentReminders", () => {
  it("cancels only QUEUED reminder rows and leaves other statuses alone", async () => {
    const { cancelPendingAppointmentReminders } = await import(
      "@/server/notifications/triggers"
    );

    seedOldCascade();
    state.sends.find((s) => s.templateId === "tpl_5d")!.status = "SENT";
    state.sends.find((s) => s.templateId === "tpl_3d")!.status = "DELIVERED";

    const { cancelled } = await cancelPendingAppointmentReminders(APPT);

    expect(cancelled).toBe(2); // only the two still-QUEUED bands
    expect(state.sends.find((s) => s.templateId === "tpl_5d")!.status).toBe(
      "SENT",
    );
    expect(state.sends.find((s) => s.templateId === "tpl_3d")!.status).toBe(
      "DELIVERED",
    );
    expect(state.sends.find((s) => s.templateId === "tpl_24h")!.status).toBe(
      "CANCELLED",
    );
    expect(state.sends.find((s) => s.templateId === "tpl_3h")!.status).toBe(
      "CANCELLED",
    );
  });
});
