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

    // EMPTY_SLOT_TOMORROW puts slot time + currency in the title
    const empty = formatActionTitle(t, SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, "ru");
    expect(empty).toContain("\"slotTime\":\"10:00\"");

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
