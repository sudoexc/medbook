/**
 * Audit TG-13 / TG-14: the scheduler's daily and per-tick passes.
 *
 *   - birthdays: month and day filtered in SQL per clinic, in the clinic's
 *     day from 09:00, once a day, once a year per patient, never for a
 *     year-only birth date; 29 February is greeted on 28 February;
 *   - payment.due: only where payments are recorded, only for an unpaid
 *     visit of a patient who owes, with the amount in сум;
 *   - case.repeat-due: the clinic's real name and phone, the patient's
 *     language, a deadline without «г..».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  clinics: [] as Array<Record<string, unknown>>,
  patients: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  rawCalls: [] as unknown[][],
  rawSql: [] as string[],
  visits: [] as Array<Record<string, unknown>>,
  appts: [] as Array<Record<string, unknown>>,
  cases: [] as Array<Record<string, unknown>>,
  debt: new Map<string, number | null>(),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => undefined),
}));
vi.mock("@/server/patient/finance", () => ({
  loadPatientFinance: vi.fn(async (_c: string, patientId: string) => ({
    debt: state.debt.get(patientId) ?? null,
  })),
}));

function isYearOnly(d: Date) {
  return d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationTemplate: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.templates.filter((t) => matchesWhere(t, where)),
      ),
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        state.templates.find((t) => matchesWhere(t, where)) ?? null,
      ),
    },
    clinic: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.clinics.filter((c) =>
          matchesWhere(c, { ...where, id: undefined }) &&
          (where.id as { in: string[] }).in.includes(c.id as string),
        ),
      ),
    },
    // SQL of the birthday pass, evaluated over the rows with its parameters:
    // clinicId, month, day1, day2.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.rawCalls.push(values);
      state.rawSql.push(strings.join("?"));
      const [clinicId, month, d1, d2] = values as [string, number, number, number];
      return state.patients
        .filter((p) => {
          const b = p.birthDate as Date | null;
          return (
            p.clinicId === clinicId &&
            p.deletedAt === null &&
            p.marketingOptOut === false &&
            b !== null &&
            b.getUTCMonth() + 1 === month &&
            [d1, d2].includes(b.getUTCDate()) &&
            !isYearOnly(b)
          );
        })
        .map((p) => ({ id: p.id }));
    }),
    patient: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        state.patients.filter((p) => where.id.in.includes(p.id as string)),
      ),
    },
    notificationSend: {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        const w = { ...where } as Row;
        // Relation-free fields only; `in` lists are handled by the matcher.
        return state.sends.filter((s) => matchesWhere(s, w));
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        state.created.push(...data);
        return { count: data.length };
      }),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        if ((where.id as { in?: string[] } | undefined)?.in) {
          return state.appts.filter((a) => (where.id as { in: string[] }).in.includes(a.id as string));
        }
        return state.visits.filter((v) => v.clinicId === where.clinicId);
      }),
    },
    exchangeRate: { findFirst: vi.fn(async () => null) },
    service: {
      aggregate: vi.fn(async () => ({ _max: { freeRepeatDays: 14 } })),
    },
    medicalCase: {
      findMany: vi.fn(async ({ cursor }: { cursor?: unknown }) => (cursor ? [] : state.cases)),
    },
  },
}));

const CLINIC = {
  id: "c1",
  nameRu: "НейроФакс",
  nameUz: "NeuroFax",
  phone: "+998712000000",
  addressRu: "Ташкент",
  addressUz: "Toshkent",
  timezone: "Asia/Tashkent",
  paymentsTrackedSince: null as Date | null,
};

beforeEach(async () => {
  state.templates = [];
  state.clinics = [{ ...CLINIC }];
  state.patients = [];
  state.sends = [];
  state.created = [];
  state.rawCalls = [];
  state.rawSql = [];
  state.visits = [];
  state.appts = [];
  state.cases = [];
  state.debt = new Map();
  const { __resetBirthdayPassForTests } = await import("@/server/notifications/triggers");
  __resetBirthdayPassForTests();
});

// ── birthdays ───────────────────────────────────────────────────────────────

function birthdayTemplate(): Row {
  return {
    id: "tpl_bd",
    clinicId: "c1",
    trigger: "PATIENT_BIRTHDAY",
    isActive: true,
    channel: "TG",
    bodyRu: "{{patient.firstName}}, {{clinic.name}} поздравляет вас с днём рождения! {{clinic.phone}}",
    bodyUz: "{{patient.firstName}}, {{clinic.name}} sizni tug'ilgan kuningiz bilan tabriklaydi! {{clinic.phone}}",
  };
}

function person(id: string, birthDate: Date | null, over: Row = {}): Row {
  return {
    id,
    clinicId: "c1",
    // «Фамилия Имя»: the greeting takes the given name (audit TG-29).
    fullName: `Тестов ${id}`,
    phone: "+998900000000",
    telegramId: `tg_${id}`,
    preferredLang: "RU",
    marketingOptOut: false,
    deletedAt: null,
    birthDate,
    ...over,
  };
}

describe("birthdays (TG-13)", () => {
  // 2026-10-01 10:00 Tashkent
  const MORNING = new Date("2026-10-01T05:00:00.000Z");

  it("greets today's birthdays in the clinic's day, in the patient's language", async () => {
    const { _runBirthdaysForTests } = await import("@/server/notifications/triggers");
    state.templates.push(birthdayTemplate());
    state.patients.push(
      person("ali", new Date(Date.UTC(1990, 9, 1)), { preferredLang: "UZ" }),
      person("bob", new Date(Date.UTC(1985, 9, 2))),
    );
    const n = await _runBirthdaysForTests(MORNING);
    expect(n).toBe(1);
    expect(state.rawCalls[0]).toEqual(["c1", 10, 1, 1]);
    expect(state.created[0]).toMatchObject({ patientId: "ali", templateId: "tpl_bd" });
    expect(state.created[0]!.body).toBe(
      "ali, NeuroFax sizni tug'ilgan kuningiz bilan tabriklaydi! +998712000000",
    );
  });

  it("waits for 09:00 local and runs once a day", async () => {
    const { _runBirthdaysForTests } = await import("@/server/notifications/triggers");
    state.templates.push(birthdayTemplate());
    state.patients.push(person("ali", new Date(Date.UTC(1990, 9, 1))));
    // 07:00 Tashkent: not yet.
    expect(await _runBirthdaysForTests(new Date("2026-10-01T02:00:00.000Z"))).toBe(0);
    expect(state.rawCalls).toHaveLength(0);
    await _runBirthdaysForTests(MORNING);
    await _runBirthdaysForTests(new Date(MORNING.getTime() + 60_000));
    expect(state.rawCalls).toHaveLength(1);
  });

  it("greets again next year, not twice the same day", async () => {
    const { _runBirthdaysForTests } = await import("@/server/notifications/triggers");
    state.templates.push(birthdayTemplate());
    state.patients.push(person("ali", new Date(Date.UTC(1990, 9, 1))));
    state.sends.push({
      clinicId: "c1",
      patientId: "ali",
      templateId: "tpl_bd",
      appointmentId: null,
      status: "SENT",
      createdAt: new Date("2025-10-01T05:00:00.000Z"),
    });
    expect(await _runBirthdaysForTests(MORNING)).toBe(1);

    const { __resetBirthdayPassForTests } = await import("@/server/notifications/triggers");
    __resetBirthdayPassForTests();
    state.sends.push({ ...state.created[0]!, status: "SENT", createdAt: MORNING });
    state.created = [];
    expect(await _runBirthdaysForTests(new Date(MORNING.getTime() + 3_600_000))).toBe(0);
  });

  it("never greets a year-only birth date on 1 January", async () => {
    const { _runBirthdaysForTests } = await import("@/server/notifications/triggers");
    state.templates.push(birthdayTemplate());
    state.patients.push(person("yearonly", new Date(Date.UTC(1987, 0, 1))));
    expect(await _runBirthdaysForTests(new Date("2027-01-01T05:00:00.000Z"))).toBe(0);
    // The exclusion lives in the SQL itself.
    expect(state.rawSql[0]).toContain(`"birthDate"::time = TIME '00:00:00'`);
    expect(state.rawSql[0]).toContain(`"marketingOptOut" = false`);
  });

  it("costs one query when no clinic has a birthday template", async () => {
    const { _runBirthdaysForTests } = await import("@/server/notifications/triggers");
    expect(await _runBirthdaysForTests(MORNING)).toBe(0);
    expect(state.rawCalls).toHaveLength(0);
  });

  it("greets 29 February birthdays on 28 February of a common year", async () => {
    const { birthdayDaysFor } = await import("@/server/notifications/triggers");
    expect(birthdayDaysFor(2027, 2, 28)).toEqual({ month: 2, days: [28, 29] });
    expect(birthdayDaysFor(2028, 2, 28)).toEqual({ month: 2, days: [28] });
    expect(birthdayDaysFor(2028, 2, 29)).toEqual({ month: 2, days: [29] });
  });
});

// ── payment.due ─────────────────────────────────────────────────────────────

describe("payment.due (TG-13)", () => {
  const NOW = new Date("2026-10-01T06:00:00.000Z");
  const YESTERDAY = new Date("2026-09-30T05:00:00.000Z");

  function setup(over: { tracked: boolean; debt: number | null; paidOnVisit?: number }) {
    state.clinics = [{ ...CLINIC, paymentsTrackedSince: over.tracked ? new Date("2026-09-01") : null }];
    state.templates.push({
      id: "tpl_pay",
      clinicId: "c1",
      key: "payment.due",
      isActive: true,
      channel: "TG",
      triggerConfig: null,
      bodyRu: "{{patient.firstName}}, к оплате {{payment.amount}}. {{clinic.name}}",
      bodyUz: "",
    });
    state.visits.push({
      id: "v1",
      clinicId: "c1",
      patientId: "p1",
      priceFinal: 15_000_000,
      completedAt: YESTERDAY,
      payments: over.paidOnVisit
        ? [{ amount: over.paidOnVisit, refundedAmount: 0, currency: "UZS", fxRate: null }]
        : [],
    });
    state.appts.push({
      id: "v1",
      clinicId: "c1",
      patientId: "p1",
      date: YESTERDAY,
      time: "10:00",
      endDate: YESTERDAY,
      status: "COMPLETED",
      confirmedAt: null,
      patient: {
        id: "p1",
        fullName: "Каримов Азиз",
        phone: "+998901112233",
        telegramId: "tg_1",
        preferredChannel: "TG",
        preferredLang: "RU",
        birthDate: null,
      },
      doctor: { nameRu: "Султанов", nameUz: "Sultanov" },
      primaryService: null,
      cabinet: null,
      clinic: CLINIC,
    });
    state.debt.set("p1", over.debt);
  }

  it("names the debt in сум for an unpaid visit of yesterday", async () => {
    const { _runPaymentsDueForTests } = await import("@/server/notifications/triggers");
    setup({ tracked: true, debt: 15_000_000 });
    expect(await _runPaymentsDueForTests(NOW)).toBeGreaterThan(0);
    const tg = state.created.find((r) => r.channel === "TG")!;
    expect(tg.body).toBe("Азиз, к оплате 150 000 сум. НейроФакс");
  });

  it("says nothing in a clinic that does not record payments", async () => {
    const { _runPaymentsDueForTests } = await import("@/server/notifications/triggers");
    setup({ tracked: false, debt: null });
    expect(await _runPaymentsDueForTests(NOW)).toBe(0);
    expect(state.created).toEqual([]);
  });

  it("says nothing when a deposit already covers the visit", async () => {
    const { _runPaymentsDueForTests } = await import("@/server/notifications/triggers");
    setup({ tracked: true, debt: 0 });
    expect(await _runPaymentsDueForTests(NOW)).toBe(0);
  });

  it("names only what is left after a partial payment", async () => {
    const { paymentDueAmount } = await import("@/server/notifications/triggers");
    expect(paymentDueAmount({ priceFinal: 15_000_000, paidOnVisit: 5_000_000, patientDebt: 20_000_000 })).toBe(10_000_000);
    expect(paymentDueAmount({ priceFinal: 15_000_000, paidOnVisit: 5_000_000, patientDebt: 3_000_000 })).toBe(3_000_000);
    expect(paymentDueAmount({ priceFinal: 15_000_000, paidOnVisit: 15_000_000, patientDebt: 9_000_000 })).toBeNull();
    expect(paymentDueAmount({ priceFinal: 15_000_000, paidOnVisit: 0, patientDebt: null })).toBeNull();
  });
});

// ── case.repeat-due ─────────────────────────────────────────────────────────

describe("case.repeat-due (TG-14)", () => {
  // First visit 2026-09-19 11:00 Tashkent, 14 free days → deadline 3 October.
  const FIRST = new Date("2026-09-19T06:00:00.000Z");
  const NOW = new Date("2026-10-01T09:00:00.000Z");

  function seed(lang: "RU" | "UZ") {
    state.templates.push({
      id: "tpl_case",
      clinicId: "c1",
      trigger: "CASE_REPEAT_DUE",
      isActive: true,
      channel: "TG",
      triggerConfig: { daysBefore: 2 },
      bodyRu:
        "Здравствуйте, {{patient.firstName}}! У вас осталось {{case.daysLeft}} дн. на бесплатный повторный приём в {{clinic.name}}. Запишитесь до {{case.deadline}}. Тел: {{clinic.phone}}.",
      bodyUz:
        "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da bepul takroriy qabulga {{case.daysLeft}} kun qoldi. {{case.deadline}} gacha yozilib oling. Tel: {{clinic.phone}}.",
    });
    state.cases.push({
      id: "case_1",
      clinicId: "c1",
      patientId: "p1",
      patient: {
        fullName: "Каримов Азиз",
        phone: "+998901112233",
        telegramId: "tg_1",
        preferredChannel: "TG",
        preferredLang: lang,
      },
      appointments: [
        { id: "a1", date: FIRST, status: "COMPLETED", primaryService: { freeRepeatDays: 14 } },
      ],
    });
  }

  it("names the clinic and its phone, with a clean deadline", async () => {
    const { _runCaseRepeatRemindersForTests } = await import("@/server/notifications/triggers");
    seed("RU");
    await _runCaseRepeatRemindersForTests(NOW);
    const tg = state.created.find((r) => r.channel === "TG")!;
    expect(tg.body).toBe(
      "Здравствуйте, Азиз! У вас осталось 2 дн. на бесплатный повторный приём в НейроФакс. Запишитесь до 3 октября. Тел: +998712000000.",
    );
    expect(tg.body).not.toContain("г..");
  });

  it("writes in Uzbek for an Uzbek-speaking patient", async () => {
    const { _runCaseRepeatRemindersForTests } = await import("@/server/notifications/triggers");
    seed("UZ");
    await _runCaseRepeatRemindersForTests(NOW);
    const tg = state.created.find((r) => r.channel === "TG")!;
    expect(tg.body).toBe(
      "Assalomu alaykum, Азиз! NeuroFaxda bepul takroriy qabulga 2 kun qoldi. 3-oktabr gacha yozilib oling. Tel: +998712000000.",
    );
  });

  it("skips a case whose patient already booked the follow-up by phone (CONFIRMED)", async () => {
    const { _runCaseRepeatRemindersForTests } = await import("@/server/notifications/triggers");
    seed("RU");
    (state.cases[0]!.appointments as Row[]).push({
      id: "a2",
      date: new Date("2026-10-02T06:00:00.000Z"),
      status: "CONFIRMED",
      primaryService: null,
    });
    expect(await _runCaseRepeatRemindersForTests(NOW)).toBe(0);
  });
});
