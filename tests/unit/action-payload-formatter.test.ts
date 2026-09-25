/**
 * Unit tests for `formatActionTitle` / `formatActionBody` (Phase 13 Wave 3).
 *
 * The formatter is pure — it takes a `t`-shaped translator and a payload, and
 * returns interpolated strings keyed under `actionCenter.types.<TYPE>.{title,body}`.
 * We stub the translator with a string-builder that echoes the key plus the
 * values bag so we can assert:
 *
 *   1. every ActionType produces non-empty title + body
 *   2. the values bag is populated (no `undefined` / empty placeholders)
 *   3. discriminator-derived data (slot times, money, percentages) appears
 *      verbatim in the values bag — i.e. the formatter doesn't drop fields
 *      between `valuesFor` and the translator call
 */
import { describe, expect, it } from "vitest";

import { ACTION_TYPES, type ActionPayload, type ActionType } from "@/lib/actions/types";
import { formatActionBody, formatActionTitle, type Translator } from "@/lib/actions/format";

const SAMPLE_PAYLOADS: { [K in ActionType]: Extract<ActionPayload, { type: K }> } = {
  EMPTY_SLOT_TOMORROW: {
    type: "EMPTY_SLOT_TOMORROW",
    doctorId: "doc_1",
    doctorName: "Иванов И.И.",
    slotStart: "2026-05-07T10:00:00.000Z",
    slotEnd: "2026-05-07T10:30:00.000Z",
    specialty: "Терапевт",
    estimatedRevenueLossUzs: 15_000_000,
  },
  DORMANT_BATCH: {
    type: "DORMANT_BATCH",
    segment: "90-180",
    patientCount: 42,
    lastCampaignAt: "2026-04-01T08:00:00.000Z",
  },
  UNCONFIRMED_24H: {
    type: "UNCONFIRMED_24H",
    appointmentId: "apt_1",
    patientId: "p_1",
    patientName: "Иван Иванов",
    appointmentAt: "2026-05-07T10:00:00.000Z",
    doctorName: "Петров П.П.",
  },
  NO_SHOW_RISK_HIGH: {
    type: "NO_SHOW_RISK_HIGH",
    appointmentId: "apt_2",
    patientId: "p_2",
    patientName: "Анна Сидорова",
    risk: 0.78,
    appointmentAt: "2026-05-06T14:00:00.000Z",
  },
  CASE_REPEAT_DUE: {
    type: "CASE_REPEAT_DUE",
    caseId: "case_1",
    patientId: "p_3",
    patientName: "Мария Петрова",
    dueDate: "2026-05-10",
    lastVisitAt: "2026-04-10T11:00:00.000Z",
  },
  OVERDUE_FOLLOW_UP: {
    type: "OVERDUE_FOLLOW_UP",
    appointmentId: "apt_3",
    patientId: "p_4",
    daysSinceVisit: 12,
  },
  DOCTOR_OVERLOAD: {
    type: "DOCTOR_OVERLOAD",
    doctorId: "doc_2",
    doctorName: "Сидорова С.С.",
    queueLength: 9,
    alternativeDoctorIds: ["doc_3", "doc_4"],
  },
  IDLE_ROOM: {
    type: "IDLE_ROOM",
    cabinetId: "cab_1",
    cabinetName: "Кабинет 101",
    idleMinutes: 35,
    queueLength: 4,
  },
  PAYMENT_OVERDUE: {
    type: "PAYMENT_OVERDUE",
    appointmentId: "apt_4",
    patientId: "p_5",
    patientName: "Олег Кузнецов",
    amountUzs: 25_000_000,
    daysOverdue: 7,
  },
  LOW_DOCTOR_SCHEDULE: {
    type: "LOW_DOCTOR_SCHEDULE",
    doctorId: "doc_5",
    doctorName: "Гасанова Г.Г.",
    slotsNext7Days: 3,
  },
  // Phase 16 Wave 2 — post-visit NPS low-score sample.
  LOW_NPS_RECEIVED: {
    type: "LOW_NPS_RECEIVED",
    patientId: "p_6",
    patientName: "Виктор Семенов",
    appointmentId: "apt_5",
    doctorId: "doc_6",
    doctorName: "Каримов К.К.",
    score: 3,
    commentPreview: "Долго ждал, врач торопился",
  },
  // Wave 4 of `docs/TZ-sms-removal.md` — TG-less patient sample.
  PATIENT_NO_CHANNEL: {
    type: "PATIENT_NO_CHANNEL",
    patientId: "p_7",
    patientName: "Нурия Каримова",
    triggerKey: "appointment.reminder-24h",
    appointmentId: "apt_6",
    appointmentAt: "2026-05-08T09:30:00.000Z",
    bucket: "2026-05-07",
  },
  // Ф6 (TZ-smart-constructor) — control-visit call task sample.
  VISIT_FOLLOW_UP_DUE: {
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn_1",
    patientId: "p_8",
    patientName: "Шахноза Юсупова",
    doctorId: "doc_7",
    doctorName: "Алиев А.А.",
    dueDate: "2026-06-20",
    followUpNote: "Контроль ОАК",
  },
  // Audit MA-04 / PH-01 — Telegram account bound to a card with history.
  TELEGRAM_LINK_CONFLICT: {
    type: "TELEGRAM_LINK_CONFLICT",
    telegramCardId: "p_tg",
    telegramCardName: "Dilnoza K",
    clinicCardId: "p_clinic",
    clinicCardName: "Каримова Дилноза Рустамовна",
    via: "contact",
  },
  // Audit AC-04 — call task for a «не на связи»-only risk-today row.
  NO_CONTACT_CALL: {
    type: "NO_CONTACT_CALL",
    appointmentId: "apt_9",
    patientId: "p_9",
    patientName: "Каримова Нодира",
    appointmentAt: "2026-05-07T10:00:00.000Z",
    doctorName: "Алиев А.А.",
    daysSinceContact: 31,
  },
};

/**
 * Echo translator. We can't import a real next-intl translator in a unit test
 * (it needs a provider), but the formatter only relies on the call signature.
 * The echo lets us assert the key is well-formed AND that the values bag was
 * built — both pieces of information end up in the returned string.
 */
const makeEchoTranslator = (): Translator => (key, values) =>
  values && Object.keys(values).length > 0
    ? `${key}|${JSON.stringify(values)}`
    : key;

describe("formatActionTitle / formatActionBody", () => {
  it("returns a non-empty title and body for every ActionType", () => {
    const t = makeEchoTranslator();
    for (const type of ACTION_TYPES) {
      const p = SAMPLE_PAYLOADS[type];
      const title = formatActionTitle(t, p, "ru");
      const body = formatActionBody(t, p, "ru");
      expect(title.length, `title for ${type}`).toBeGreaterThan(0);
      expect(body.length, `body for ${type}`).toBeGreaterThan(0);
      expect(title.startsWith(`actionCenter.types.${type}.title`)).toBe(true);
      expect(body.startsWith(`actionCenter.types.${type}.body`)).toBe(true);
    }
  });

  it("forwards a non-empty values bag to the translator for every type", () => {
    const calls: Array<{ key: string; values?: Record<string, unknown> }> = [];
    const recorder: Translator = (key, values) => {
      calls.push({ key, values });
      return key;
    };
    for (const type of ACTION_TYPES) {
      formatActionTitle(recorder, SAMPLE_PAYLOADS[type], "ru");
    }
    for (const c of calls) {
      expect(c.values, `values bag for ${c.key}`).toBeTruthy();
      expect(Object.keys(c.values!).length, `values bag for ${c.key}`).toBeGreaterThan(0);
      // No undefined placeholders — those would render as "undefined" in the UI.
      for (const [k, v] of Object.entries(c.values!)) {
        expect(v, `values.${k} for ${c.key}`).not.toBeUndefined();
        expect(v, `values.${k} for ${c.key}`).not.toBeNull();
      }
    }
  });

  it("interpolates discriminator data (HH:MM, percent, money) into the bag", () => {
    const t = makeEchoTranslator();

    // EMPTY_SLOT_TOMORROW puts slot time + currency in the title. Payload
    // instants are UTC; the card reads the clinic clock (audit AC-02):
    // 10:00Z is 15:00 in Tashkent.
    const empty = formatActionTitle(t, SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, "ru");
    expect(empty).toContain("\"slotTime\":\"15:00\"");

    // NO_SHOW_RISK_HIGH renders risk as an integer percent (0.78 → 78)
    const risk = formatActionTitle(t, SAMPLE_PAYLOADS.NO_SHOW_RISK_HIGH, "ru");
    expect(risk).toContain("\"riskPct\":78");

    // PAYMENT_OVERDUE money field is present and non-empty
    const pay = formatActionTitle(t, SAMPLE_PAYLOADS.PAYMENT_OVERDUE, "ru");
    expect(pay).toMatch(/"amount":"[^"]+"/);

    // DORMANT_BATCH count comes through as a number, not a string
    const dorm = formatActionTitle(t, SAMPLE_PAYLOADS.DORMANT_BATCH, "ru");
    expect(dorm).toContain("\"patientCount\":42");
  });

  it("formats slot date with locale-aware separator (ru vs uz)", () => {
    const t = makeEchoTranslator();
    const ru = formatActionTitle(t, SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, "ru");
    const uz = formatActionTitle(t, SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, "uz");
    // Both locales include slotDate; we just assert the field is present and
    // non-empty rather than asserting a specific separator (Intl rules vary
    // between Node versions for uz-Latn-UZ).
    expect(ru).toMatch(/"slotDate":"[^"]+"/);
    expect(uz).toMatch(/"slotDate":"[^"]+"/);
  });
});

/**
 * Audit AC-02: slot times rendered the UTC clock (five hours early) and the
 * UNCONFIRMED_24H title said «завтра» for every row, although the detector
 * looks 72h ahead starting now. Render the real ICU strings in both languages.
 */
describe("appointment time on the clinic clock (real messages)", () => {
  // 2026-05-07 11:00 in Tashkent.
  const NOW = new Date("2026-05-07T06:00:00.000Z");

  async function renderer(lang: "ru" | "uz") {
    const { default: IntlMessageFormat } = await import("intl-messageformat");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const messages = JSON.parse(
      readFileSync(path.join(process.cwd(), `src/messages/${lang}.json`), "utf8"),
    ) as Record<string, unknown>;
    const t: Translator = (key, values) => {
      const msg = key
        .split(".")
        .reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], messages);
      return new IntlMessageFormat(msg as string, lang).format(values) as string;
    };
    return t;
  }

  const unconfirmedAt = (appointmentAt: string) => ({
    ...SAMPLE_PAYLOADS.UNCONFIRMED_24H,
    appointmentAt,
  });

  it("09:00Z reads 14:00 on every card that shows the slot time", async () => {
    const t = await renderer("ru");
    const at = "2026-05-07T09:00:00.000Z";
    expect(formatActionTitle(t, unconfirmedAt(at), "ru", NOW)).toContain("14:00");
    expect(
      formatActionBody(
        t,
        { ...SAMPLE_PAYLOADS.NO_SHOW_RISK_HIGH, appointmentAt: at },
        "ru",
        NOW,
      ),
    ).toContain("14:00");
    expect(
      formatActionTitle(
        t,
        { ...SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, slotStart: at },
        "ru",
        NOW,
      ),
    ).toContain("14:00");
    expect(
      formatActionBody(
        t,
        { ...SAMPLE_PAYLOADS.PATIENT_NO_CHANNEL, appointmentAt: at },
        "ru",
        NOW,
      ),
    ).toContain("14:00");
  });

  it("says «сегодня» for today's visit, «завтра» for tomorrow's, the date beyond", async () => {
    const ru = await renderer("ru");
    const today = formatActionTitle(ru, unconfirmedAt("2026-05-07T11:00:00.000Z"), "ru", NOW);
    expect(today).toContain("сегодня в 16:00");
    expect(today).not.toContain("завтра");
    expect(
      formatActionTitle(ru, unconfirmedAt("2026-05-08T04:00:00.000Z"), "ru", NOW),
    ).toContain("завтра в 09:00");
    const later = formatActionTitle(ru, unconfirmedAt("2026-05-09T13:30:00.000Z"), "ru", NOW);
    expect(later).toContain("09.05 в 18:30");
    expect(later).not.toMatch(/сегодня|завтра/);
  });

  it("uses the clinic day, not the UTC day, at the evening boundary", async () => {
    const ru = await renderer("ru");
    // 20:30Z on the 7th is 01:30 on the 8th in Tashkent: tomorrow, not today.
    expect(
      formatActionTitle(ru, unconfirmedAt("2026-05-07T20:30:00.000Z"), "ru", NOW),
    ).toContain("завтра в 01:30");
  });

  it("renders the same choice in Uzbek, without dashes", async () => {
    const uz = await renderer("uz");
    const today = formatActionTitle(uz, unconfirmedAt("2026-05-07T11:00:00.000Z"), "uz", NOW);
    expect(today).toContain("bugun 16:00");
    expect(today).not.toContain("ertaga");
    expect(today).not.toMatch(/[—–]/);
    expect(
      formatActionTitle(uz, unconfirmedAt("2026-05-08T04:00:00.000Z"), "uz", NOW),
    ).toContain("ertaga 09:00");
  });

  it("titles the NO_CONTACT_CALL task with the clinic time in both languages", async () => {
    for (const lang of ["ru", "uz"] as const) {
      const t = await renderer(lang);
      const title = formatActionTitle(t, SAMPLE_PAYLOADS.NO_CONTACT_CALL, lang, NOW);
      const body = formatActionBody(t, SAMPLE_PAYLOADS.NO_CONTACT_CALL, lang, NOW);
      expect(title).toContain("Каримова Нодира");
      expect(title).toContain("15:00");
      expect(body).toContain("Алиев А.А.");
      expect(`${title} ${body}`).not.toMatch(/[—–]/);
    }
  });
});

/**
 * Review of PH-01: a shared contact whose name is not the clinic card's name
 * links nothing and raises TELEGRAM_LINK_CONFLICT with via "contactName".
 * The real ICU strings must render that branch in both languages.
 */
describe("TELEGRAM_LINK_CONFLICT copy (real messages)", () => {
  it("renders every `via` in ru and uz, the contactName branch naming both cards, without dashes", async () => {
    const { default: IntlMessageFormat } = await import("intl-messageformat");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const lang of ["ru", "uz"] as const) {
      const messages = JSON.parse(
        readFileSync(path.join(process.cwd(), `src/messages/${lang}.json`), "utf8"),
      ) as { actionCenter: { types: Record<string, { title: string; body: string }> } };
      const copy = messages.actionCenter.types.TELEGRAM_LINK_CONFLICT!;
      for (const via of ["invite", "contact", "contactName", "dedupe"]) {
        const values = {
          clinicCardName: "Каримова Дилноза",
          telegramCardName: "Timur Karimov",
          via,
        };
        const title = new IntlMessageFormat(copy.title, lang).format(values) as string;
        const body = new IntlMessageFormat(copy.body, lang).format(values) as string;
        expect(title).toContain("Каримова Дилноза");
        expect(body).toContain("Timur Karimov");
        if (via === "contactName") {
          expect(title).not.toMatch(/[—–]/);
          expect(body).not.toMatch(/[—–]/);
        }
      }
    }
  });
});
