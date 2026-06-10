/**
 * Unit tests for the Action Center type module (Phase 13 Wave 1).
 *
 * Covers:
 *   - dedupeKeyFor: same payload → same key, any field change → different key.
 *   - defaultSeverity: returns a valid severity for every ActionType.
 *   - defaultDeeplinkPath / defaultAssigneeRole: total over the type union.
 *   - Type guards return the correct narrowing for valid + invalid input.
 *
 * Pure module — no Prisma, no Next runtime.
 */
import { describe, it, expect } from "vitest";

import {
  ACTION_SEVERITIES,
  ACTION_STATUSES,
  ACTION_TYPES,
  dedupeKeyFor,
  defaultAssigneeRole,
  defaultDeeplinkPath,
  defaultSeverity,
  isActionSeverity,
  isActionStatus,
  isActionType,
  type ActionPayload,
  type ActionType,
  type ActionSeverity,
} from "@/lib/actions/types";

// ──────────────────────────────────────────────────────────────────────────
// Sample payloads — one of every type. Used as a seed for the property-style
// "any field change → different key" tests.
// ──────────────────────────────────────────────────────────────────────────

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
  // Phase 16 Wave 2 — sample for the post-visit NPS low-score action.
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
  // Wave 4 of `docs/TZ-sms-removal.md` — TG-less patient compensator sample.
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
};

describe("ACTION_TYPES surface", () => {
  it("ACTION_TYPES has exactly 13 entries (Wave 1 + Phase 16 Wave 2 + sms-removal Wave 4 + Ф6)", () => {
    expect(ACTION_TYPES.length).toBe(13);
    expect(new Set(ACTION_TYPES).size).toBe(13);
  });

  it("ACTION_SEVERITIES + ACTION_STATUSES are non-empty and unique", () => {
    expect(ACTION_SEVERITIES.length).toBeGreaterThan(0);
    expect(new Set(ACTION_SEVERITIES).size).toBe(ACTION_SEVERITIES.length);
    expect(ACTION_STATUSES.length).toBeGreaterThan(0);
    expect(new Set(ACTION_STATUSES).size).toBe(ACTION_STATUSES.length);
  });

  it("SAMPLE_PAYLOADS covers every ActionType (test self-consistency)", () => {
    const covered = new Set(ACTION_TYPES.map((t) => SAMPLE_PAYLOADS[t].type));
    expect(covered.size).toBe(ACTION_TYPES.length);
  });
});

describe("dedupeKeyFor", () => {
  it("returns a stable string for an identical payload (called twice)", () => {
    for (const t of ACTION_TYPES) {
      const p = SAMPLE_PAYLOADS[t];
      const k1 = dedupeKeyFor(p);
      const k2 = dedupeKeyFor({ ...p });
      expect(k1).toBe(k2);
    }
  });

  it("differs across types even when scalar fields collide", () => {
    const a = dedupeKeyFor(SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW);
    const b = dedupeKeyFor(SAMPLE_PAYLOADS.UNCONFIRMED_24H);
    expect(a).not.toBe(b);
  });

  it("changes when a discriminator field changes", () => {
    // Per type: pick a field we expect to participate in the key and tweak.
    const variants: Array<[ActionType, ActionPayload, ActionPayload]> = [
      [
        "EMPTY_SLOT_TOMORROW",
        SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW,
        { ...SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW, doctorId: "doc_xxx" },
      ],
      [
        "EMPTY_SLOT_TOMORROW",
        SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW,
        {
          ...SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW,
          slotStart: "2026-05-08T10:00:00.000Z",
        },
      ],
      [
        "DORMANT_BATCH",
        SAMPLE_PAYLOADS.DORMANT_BATCH,
        { ...SAMPLE_PAYLOADS.DORMANT_BATCH, segment: "365+" },
      ],
      [
        "UNCONFIRMED_24H",
        SAMPLE_PAYLOADS.UNCONFIRMED_24H,
        { ...SAMPLE_PAYLOADS.UNCONFIRMED_24H, appointmentId: "apt_99" },
      ],
      [
        "NO_SHOW_RISK_HIGH",
        SAMPLE_PAYLOADS.NO_SHOW_RISK_HIGH,
        { ...SAMPLE_PAYLOADS.NO_SHOW_RISK_HIGH, appointmentId: "apt_88" },
      ],
      [
        "CASE_REPEAT_DUE",
        SAMPLE_PAYLOADS.CASE_REPEAT_DUE,
        { ...SAMPLE_PAYLOADS.CASE_REPEAT_DUE, caseId: "case_77" },
      ],
      [
        "OVERDUE_FOLLOW_UP",
        SAMPLE_PAYLOADS.OVERDUE_FOLLOW_UP,
        { ...SAMPLE_PAYLOADS.OVERDUE_FOLLOW_UP, appointmentId: "apt_55" },
      ],
      [
        "DOCTOR_OVERLOAD",
        SAMPLE_PAYLOADS.DOCTOR_OVERLOAD,
        { ...SAMPLE_PAYLOADS.DOCTOR_OVERLOAD, doctorId: "doc_99" },
      ],
      [
        "IDLE_ROOM",
        SAMPLE_PAYLOADS.IDLE_ROOM,
        { ...SAMPLE_PAYLOADS.IDLE_ROOM, cabinetId: "cab_77" },
      ],
      [
        "PAYMENT_OVERDUE",
        SAMPLE_PAYLOADS.PAYMENT_OVERDUE,
        { ...SAMPLE_PAYLOADS.PAYMENT_OVERDUE, appointmentId: "apt_42" },
      ],
      [
        "LOW_DOCTOR_SCHEDULE",
        SAMPLE_PAYLOADS.LOW_DOCTOR_SCHEDULE,
        { ...SAMPLE_PAYLOADS.LOW_DOCTOR_SCHEDULE, doctorId: "doc_42" },
      ],
    ];
    for (const [, a, b] of variants) {
      expect(dedupeKeyFor(a)).not.toBe(dedupeKeyFor(b));
    }
  });

  it("ignores non-discriminator fields (revenue / counts / labels)", () => {
    // Display-only fields don't contribute — two slot rows with different
    // estimated revenue but identical doctorId+slotStart MUST collapse.
    const a = SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW;
    const b: ActionPayload = {
      ...a,
      estimatedRevenueLossUzs: a.estimatedRevenueLossUzs + 99_999,
      doctorName: "Different Name",
      specialty: "Different Specialty",
      slotEnd: "2099-12-31T23:59:59.000Z",
    };
    expect(dedupeKeyFor(a)).toBe(dedupeKeyFor(b));
  });

  it("starts every key with the action type prefix", () => {
    for (const t of ACTION_TYPES) {
      const k = dedupeKeyFor(SAMPLE_PAYLOADS[t]);
      expect(k.startsWith(`${t}:`)).toBe(true);
    }
  });
});

describe("defaultSeverity", () => {
  it("returns a valid ActionSeverity for every ActionType", () => {
    for (const t of ACTION_TYPES) {
      const s = defaultSeverity(t);
      expect(ACTION_SEVERITIES).toContain(s);
    }
  });

  it("escalates revenue-/no-show-critical types to 'critical'", () => {
    expect(defaultSeverity("PAYMENT_OVERDUE")).toBe("critical");
    expect(defaultSeverity("NO_SHOW_RISK_HIGH")).toBe("critical");
  });

  it("rates LOW_DOCTOR_SCHEDULE as 'low' (forward-looking, not urgent)", () => {
    expect(defaultSeverity("LOW_DOCTOR_SCHEDULE")).toBe("low");
  });
});

describe("defaultDeeplinkPath", () => {
  it("returns a non-empty CRM-rooted path for every ActionType", () => {
    for (const t of ACTION_TYPES) {
      const p = defaultDeeplinkPath(t);
      expect(p.length).toBeGreaterThan(0);
      expect(p.startsWith("/crm/")).toBe(true);
    }
  });
});

describe("defaultAssigneeRole", () => {
  it("returns ADMIN | RECEPTIONIST | null for every ActionType", () => {
    const allowed = new Set(["ADMIN", "RECEPTIONIST", null] as const);
    for (const t of ACTION_TYPES) {
      const r = defaultAssigneeRole(t);
      expect(allowed.has(r as never)).toBe(true);
    }
  });

  it("matches the ROADMAP table for high-signal cases", () => {
    expect(defaultAssigneeRole("EMPTY_SLOT_TOMORROW")).toBe("RECEPTIONIST");
    expect(defaultAssigneeRole("DORMANT_BATCH")).toBe("ADMIN");
    expect(defaultAssigneeRole("LOW_DOCTOR_SCHEDULE")).toBe("ADMIN");
    expect(defaultAssigneeRole("PAYMENT_OVERDUE")).toBe("RECEPTIONIST");
  });
});

describe("type guards", () => {
  it("isActionType narrows for valid + rejects invalid", () => {
    expect(isActionType("EMPTY_SLOT_TOMORROW")).toBe(true);
    expect(isActionType("UNKNOWN_ACTION")).toBe(false);
  });
  it("isActionSeverity narrows for valid + rejects invalid", () => {
    expect(isActionSeverity("critical")).toBe(true);
    expect(isActionSeverity("BLOCKER")).toBe(false);
  });
  it("isActionStatus narrows for valid + rejects invalid", () => {
    expect(isActionStatus("OPEN")).toBe(true);
    expect(isActionStatus("PENDING")).toBe(false);
  });
});

describe("compile-time discriminated-union narrowing", () => {
  it("narrows by `type` (compiles + runtime sanity)", () => {
    // The function below would not compile if the union were not a proper
    // discriminated union — a regression in `ActionPayload` would surface
    // here as a TypeScript error first, then this runtime check.
    function narrowSpecialty(p: ActionPayload): string | null {
      switch (p.type) {
        case "EMPTY_SLOT_TOMORROW":
          return p.specialty;
        case "DORMANT_BATCH":
          return p.segment;
        case "UNCONFIRMED_24H":
          return p.patientName;
        case "NO_SHOW_RISK_HIGH":
          return p.patientName;
        case "CASE_REPEAT_DUE":
          return p.patientName;
        case "OVERDUE_FOLLOW_UP":
          return null;
        case "DOCTOR_OVERLOAD":
          return p.doctorName;
        case "IDLE_ROOM":
          return p.cabinetName;
        case "PAYMENT_OVERDUE":
          return p.patientName;
        case "LOW_DOCTOR_SCHEDULE":
          return p.doctorName;
        case "LOW_NPS_RECEIVED":
          return p.patientName;
        case "PATIENT_NO_CHANNEL":
          return p.patientName;
        case "VISIT_FOLLOW_UP_DUE":
          return p.patientName;
        default: {
          const _exhaustive: never = p;
          return _exhaustive;
        }
      }
    }
    expect(narrowSpecialty(SAMPLE_PAYLOADS.EMPTY_SLOT_TOMORROW)).toBe("Терапевт");
    expect(narrowSpecialty(SAMPLE_PAYLOADS.DOCTOR_OVERLOAD)).toBe("Сидорова С.С.");
  });
});

// Force `ActionSeverity` import to be referenced (used in mapped type above).
const _refSeverity: ActionSeverity[] = [...ACTION_SEVERITIES];
void _refSeverity;
