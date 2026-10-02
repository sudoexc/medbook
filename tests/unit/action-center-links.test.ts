/**
 * Audit AC-14 — every link out of the Action Center opens a page that exists.
 *
 * «Перезвонить» on a debt went to `/crm/payments`, a case repeat to
 * `/crm/cases`, «Открыть запись» to `/crm/appointments/<id>`: all 404. A low
 * rating reloaded the Action Center itself. These tests resolve each link
 * against the App Router tree under `src/app/[locale]`, so a link to a page
 * that does not exist fails here rather than in front of reception.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTION_TYPES,
  actionDeeplinkPath,
  actionRowDeeplinkPath,
  defaultDeeplinkPath,
  type ActionPayload,
  type ActionType,
} from "@/lib/actions/types";

const APP = path.join(process.cwd(), "src/app/[locale]");

/** Route groups `(x)` do not add a URL segment. */
function childDirs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (/^\(.+\)$/.test(name)) out.push(...childDirs(full).map((d) => path.join(name, d)));
    else out.push(name);
  }
  return out;
}

/**
 * True when a `page.tsx` answers the URL path. `:dyn` marks a segment built
 * from a value (`${id}`), which only a `[param]` folder can answer.
 */
function pageExists(urlPath: string): boolean {
  const pathname = urlPath.split(/[?#]/)[0]!;
  const segments = pathname.split("/").filter(Boolean);
  let dirs = [APP];
  for (const seg of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      for (const child of childDirs(dir)) {
        const name = path.basename(child);
        const dynamic = /^\[.+\]$/.test(name);
        if ((seg === ":dyn" && dynamic) || (seg !== ":dyn" && (name === seg || dynamic))) {
          next.push(path.join(dir, child));
        }
      }
    }
    dirs = next;
    if (dirs.length === 0) return false;
  }
  return dirs.some((d) => existsSync(path.join(d, "page.tsx")));
}

/** A sample payload per type, with ids, so the builder takes its main path. */
const SAMPLES: Record<ActionType, ActionPayload> = {
  EMPTY_SLOT_TOMORROW: {
    type: "EMPTY_SLOT_TOMORROW",
    doctorId: "d1",
    doctorName: "x",
    slotStart: "2026-10-01T04:00:00.000Z",
    slotEnd: "2026-10-01T06:00:00.000Z",
    specialty: "x",
    estimatedRevenueLossUzs: 1,
  },
  DORMANT_BATCH: {
    type: "DORMANT_BATCH",
    segment: "90-180",
    patientCount: 30,
    lastCampaignAt: null,
  },
  UNCONFIRMED_24H: {
    type: "UNCONFIRMED_24H",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    appointmentAt: "2026-10-01T04:00:00.000Z",
    doctorName: "x",
  },
  NO_SHOW_RISK_HIGH: {
    type: "NO_SHOW_RISK_HIGH",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    risk: 0.8,
    appointmentAt: "2026-10-01T04:00:00.000Z",
  },
  CASE_REPEAT_DUE: {
    type: "CASE_REPEAT_DUE",
    caseId: "case1",
    patientId: "p1",
    patientName: "x",
    dueDate: "2026-10-05",
    lastVisitAt: "2026-09-21T04:00:00.000Z",
  },
  OVERDUE_FOLLOW_UP: {
    type: "OVERDUE_FOLLOW_UP",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    daysSinceVisit: 9,
  },
  DOCTOR_OVERLOAD: {
    type: "DOCTOR_OVERLOAD",
    doctorId: "d1",
    doctorName: "x",
    queueLength: 9,
    alternativeDoctorIds: [],
  },
  IDLE_ROOM: {
    type: "IDLE_ROOM",
    cabinetId: "cab1",
    cabinetName: "x",
    idleMinutes: 25,
    queueLength: 2,
  },
  PAYMENT_OVERDUE: {
    type: "PAYMENT_OVERDUE",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    amountUzs: 100,
    daysOverdue: 3,
  },
  LOW_DOCTOR_SCHEDULE: {
    type: "LOW_DOCTOR_SCHEDULE",
    doctorId: "d1",
    doctorName: "x",
    slotsNext7Days: 2,
  },
  LOW_NPS_RECEIVED: {
    type: "LOW_NPS_RECEIVED",
    patientId: "p1",
    patientName: "x",
    appointmentId: "ap1",
    doctorId: "d1",
    doctorName: "x",
    score: 3,
    commentPreview: "",
  },
  PATIENT_NO_CHANNEL: {
    type: "PATIENT_NO_CHANNEL",
    patientId: "p1",
    patientName: "x",
    triggerKey: "appointment.reminder-24h",
    appointmentId: "ap1",
    appointmentAt: null,
    bucket: "2026-09-30",
  },
  VISIT_FOLLOW_UP_DUE: {
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn1",
    patientId: "p1",
    patientName: "x",
    doctorId: "d1",
    doctorName: "x",
    dueDate: "2026-10-10",
    followUpNote: "",
  },
  TELEGRAM_LINK_CONFLICT: {
    type: "TELEGRAM_LINK_CONFLICT",
    telegramCardId: "p2",
    telegramCardName: "x",
    clinicCardId: "p1",
    clinicCardName: "x",
    via: "invite",
  },
  NO_CONTACT_CALL: {
    type: "NO_CONTACT_CALL",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    appointmentAt: "2026-10-01T04:00:00.000Z",
    doctorName: "x",
    daysSinceContact: null,
  },
  PATIENT_CALLBACK: {
    type: "PATIENT_CALLBACK",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    doctorName: "x",
    appointmentAt: "2026-10-01T04:00:00.000Z",
    reason: "CALLBACK",
    callbackAt: "2026-10-01T06:00:00.000Z",
    note: "",
  },
  SELF_CHECK_IN_UNHANDLED: {
    type: "SELF_CHECK_IN_UNHANDLED",
    appointmentId: "ap1",
    patientId: "p1",
    patientName: "x",
    doctorName: "x",
    appointmentAt: "2026-10-01T04:00:00.000Z",
    arrivedAt: "2026-10-01T03:55:00.000Z",
  },
};

describe("actionDeeplinkPath", () => {
  it.each([...ACTION_TYPES])("%s opens an existing page", (type) => {
    const link = actionDeeplinkPath(SAMPLES[type]);
    expect(link.startsWith("/crm/")).toBe(true);
    expect(pageExists(link), link).toBe(true);
  });

  it.each([...ACTION_TYPES])("%s falls back to an existing page", (type) => {
    const link = defaultDeeplinkPath(type);
    expect(pageExists(link), link).toBe(true);
  });

  it("opens the entity the task is about", () => {
    expect(actionDeeplinkPath(SAMPLES.PAYMENT_OVERDUE)).toBe("/crm/appointments?ap=ap1");
    expect(actionDeeplinkPath(SAMPLES.UNCONFIRMED_24H)).toBe("/crm/appointments?ap=ap1");
    // The drawer holds «Пришёл» / «Не пришёл» for the unanswered check-in.
    expect(actionDeeplinkPath(SAMPLES.SELF_CHECK_IN_UNHANDLED)).toBe(
      "/crm/appointments?ap=ap1",
    );
    expect(actionDeeplinkPath(SAMPLES.CASE_REPEAT_DUE)).toBe("/crm/cases/case1");
    expect(actionDeeplinkPath(SAMPLES.LOW_NPS_RECEIVED)).toBe("/crm/patients/p1");
    expect(actionDeeplinkPath(SAMPLES.TELEGRAM_LINK_CONFLICT)).toBe("/crm/patients/p1");
    expect(actionDeeplinkPath(SAMPLES.LOW_DOCTOR_SCHEDULE)).toBe("/crm/doctors/d1");
    // Tomorrow's slot opens that clinic day in the calendar, for that doctor.
    expect(actionDeeplinkPath(SAMPLES.EMPTY_SLOT_TOMORROW)).toBe(
      "/crm/calendar?date=2026-10-01&doctors=d1",
    );
    expect(actionDeeplinkPath(SAMPLES.DORMANT_BATCH)).toBe(
      "/crm/notifications/campaigns/new?segment=90-180",
    );
  });

  it("a payload without its id falls back instead of building /undefined", () => {
    const broken = { ...SAMPLES.CASE_REPEAT_DUE, caseId: "" } as ActionPayload;
    expect(actionDeeplinkPath(broken)).toBe(defaultDeeplinkPath("CASE_REPEAT_DUE"));
  });

  it("a stored row uses its payload over a dead stored path", () => {
    expect(
      actionRowDeeplinkPath({
        type: "PAYMENT_OVERDUE",
        payload: SAMPLES.PAYMENT_OVERDUE,
        deeplinkPath: "/crm/payments",
      }),
    ).toBe("/crm/appointments?ap=ap1");
    // Unreadable payload: the stored path, else the type's fallback.
    expect(
      actionRowDeeplinkPath({ type: "CASE_REPEAT_DUE", payload: null, deeplinkPath: null }),
    ).toBe(defaultDeeplinkPath("CASE_REPEAT_DUE"));
  });
});

/** Source files whose links the Action Center renders or stores. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every `/crm/...` string or template literal in code (comments dropped). */
function crmLinksIn(file: string): string[] {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const links: string[] = [];
  const re = /["'`](?:\/\$\{locale\})?(\/crm\/[^"'`\s]*)/g;
  for (const m of code.matchAll(re)) {
    // `${...}` inside a path is a value: a dynamic segment.
    links.push(m[1]!.replace(/\$\{[^}]*\}/g, ":dyn"));
  }
  return links;
}

describe("links in the Action Center code", () => {
  const files = [
    ...sourcesUnder(path.join(APP, "crm/action-center")),
    ...sourcesUnder(path.join(process.cwd(), "src/server/actions")),
  ];

  it("finds the links it checks", () => {
    const all = files.flatMap(crmLinksIn);
    expect(all.length).toBeGreaterThan(10);
  });

  it("every one opens an existing page", () => {
    const dead: string[] = [];
    for (const file of files) {
      for (const link of crmLinksIn(file)) {
        if (!pageExists(link)) dead.push(`${path.relative(process.cwd(), file)}: ${link}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("no longer links to the pages that never existed", () => {
    const all = files.flatMap(crmLinksIn).map((l) => l.split(/[?#]/)[0]);
    expect(all).not.toContain("/crm/payments");
    expect(all).not.toContain("/crm/cases");
    expect(all).not.toContain("/crm/appointments/:dyn");
  });
});
