/**
 * The call center's pure rules (audit CM-01, CM-06, CM-07, CM-10, CM-11,
 * CM-13, AC-16): provider timestamps and secrets, how a call closes, the
 * notes buffer, what the caller panel shows, which list opens, who works
 * the Action Center.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  operatorCandidate,
  parseProviderTimestamp,
  readExtensionMap,
  sipSecretMatches,
} from "@/server/telephony/sip-event";
import {
  CALLED_BACK_TAG,
  hangupUpdate,
  isCallOver,
  missedUpdate,
  operatorEndUpdate,
  pendingMissedCallsWhere,
  talkSeconds,
} from "@/lib/calls/call-state";
import {
  initialNotesBuffer,
  notesSaved,
  reconcileNotesBuffer,
} from "@/lib/calls/notes-buffer";
import {
  appointmentDrawerHref,
  averageCheckOf,
  knownBalanceOf,
  pickNextAppointment,
} from "@/lib/calls/caller-context";
import { pickQueueTab } from "@/lib/calls/queue-tab";
import { canUseCallCenter } from "@/lib/calls/roles";
import {
  ACTION_READER_ROLES,
  ACTION_WORKER_ROLES,
  canRecordRiskOutcome,
  canWorkActionCenter,
} from "@/lib/actions/roles";
import {
  canMutateStatus,
  canUseQueueStatusRoute,
} from "@/lib/appointments/lifecycle";

function src(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("CM-01 — provider timestamps", () => {
  it("reads unix seconds (number or digits, fractions allowed)", () => {
    expect(parseProviderTimestamp(1776852000)?.toISOString()).toBe(
      "2026-04-22T10:00:00.000Z",
    );
    expect(parseProviderTimestamp("1776852000.5")?.toISOString()).toBe(
      "2026-04-22T10:00:00.500Z",
    );
  });

  it("reads ISO 8601 with a zone, in either form", () => {
    expect(parseProviderTimestamp("2026-04-22T15:00:00+05:00")?.toISOString()).toBe(
      "2026-04-22T10:00:00.000Z",
    );
    expect(parseProviderTimestamp("2026-04-22T10:00:00Z")?.toISOString()).toBe(
      "2026-04-22T10:00:00.000Z",
    );
  });

  it("refuses what it would have to guess", () => {
    // No zone: UTC on the server, five hours off the clinic clock.
    expect(parseProviderTimestamp("2026-04-22T15:00:00")).toBeNull();
    // Milliseconds: read as seconds this is the year 58000.
    expect(parseProviderTimestamp(1776852000000)).toBeNull();
    expect(parseProviderTimestamp(0)).toBeNull();
    expect(parseProviderTimestamp("yesterday")).toBeNull();
    expect(parseProviderTimestamp(null)).toBeNull();
  });
});

describe("CM-01 — secret and operator", () => {
  it("compares the secret without leaking its length", () => {
    expect(sipSecretMatches("correct-horse", "correct-horse")).toBe(true);
    expect(sipSecretMatches("correct-hors", "correct-horse")).toBe(false);
    expect(sipSecretMatches("", "correct-horse")).toBe(false);
  });

  it("maps a PBX extension to a user, else passes the id on to be checked", () => {
    const ext = readExtensionMap({ webhookSecret: "x", extensions: { "101": "u1", bad: 5 } });
    expect(ext).toEqual({ "101": "u1" });
    expect(operatorCandidate("101", ext)).toBe("u1");
    expect(operatorCandidate("u_cuid", ext)).toBe("u_cuid");
    expect(operatorCandidate(" ", ext)).toBeNull();
    expect(operatorCandidate(null, ext)).toBeNull();
    expect(readExtensionMap(null)).toEqual({});
  });

  it("the webhook takes the secret from the header only", () => {
    const route = src("src/app/api/calls/sip/event/route.ts");
    expect(route).toContain('request.headers.get("x-sip-secret")');
    expect(route).not.toMatch(/searchParams\.get\("secret"\)/);
    // A failed write answers 500 so the provider retries (not 200 + log).
    expect(route).toContain('jsonResponse({ error: "internal" }, 500)');
  });
});

describe("CM-07 / CM-10 — how a call closes", () => {
  const live = {
    direction: "IN" as const,
    status: "RINGING" as const,
    answeredAt: null,
    endedAt: null,
    tags: [] as string[],
  };
  const end = new Date("2026-04-22T10:03:00Z");

  it("an unanswered hangup is a missed inbound call with no duration", () => {
    expect(hangupUpdate(live, end)).toEqual({
      endedAt: end,
      status: "MISSED",
      direction: "MISSED",
      durationSec: null,
    });
  });

  it("an answered hangup is ENDED with the talk time only", () => {
    const answered = { ...live, status: "ANSWERED" as const, answeredAt: new Date("2026-04-22T10:01:00Z") };
    expect(hangupUpdate(answered, end)).toEqual({
      endedAt: end,
      status: "ENDED",
      durationSec: 120,
    });
  });

  it("an unanswered OUTBOUND call is not a missed call to return", () => {
    expect(missedUpdate({ direction: "OUT" }, end)).toEqual({
      endedAt: end,
      status: "MISSED",
      durationSec: null,
    });
  });

  it("«Завершить» ends the call; the duration only from a known answer", () => {
    expect(operatorEndUpdate({ answeredAt: null }, end)).toEqual({
      endedAt: end,
      status: "ENDED",
      durationSec: null,
    });
    expect(talkSeconds("2026-04-22T10:02:30Z", end)).toBe(30);
  });

  it("a call with an end or a terminal status is over", () => {
    expect(isCallOver({ status: "RINGING", endedAt: null })).toBe(false);
    expect(isCallOver({ status: "RINGING", endedAt: end })).toBe(true);
    expect(isCallOver({ status: "MISSED", endedAt: null })).toBe(true);
  });
});

describe("CM-13 — missed calls waiting for a call back", () => {
  it("the badge counts today's missed calls not marked «Перезвонили»", () => {
    const from = new Date("2026-04-21T19:00:00Z");
    const to = new Date("2026-04-22T19:00:00Z");
    expect(pendingMissedCallsWhere(from, to)).toEqual({
      direction: "MISSED",
      createdAt: { gte: from, lt: to },
      NOT: { tags: { has: CALLED_BACK_TAG } },
    });
    expect(src("src/app/api/crm/shell-summary/route.ts")).toContain(
      "pendingMissedCallsWhere(todayStart, todayEnd)",
    );
  });

  it("the left column opens the missed list from the badge, the old intent link, or when nothing rings", () => {
    const base = { tabParam: null, intentParam: null, ringingCount: 0, pendingMissedCount: 0 };
    expect(pickQueueTab(base)).toBe("incoming");
    expect(pickQueueTab({ ...base, pendingMissedCount: 3 })).toBe("missed");
    expect(pickQueueTab({ ...base, pendingMissedCount: 3, ringingCount: 1 })).toBe("incoming");
    expect(pickQueueTab({ ...base, intentParam: "missed-calls", ringingCount: 2 })).toBe("missed");
    expect(pickQueueTab({ ...base, tabParam: "incoming", pendingMissedCount: 3 })).toBe("incoming");
    expect(pickQueueTab({ ...base, tabParam: "missed" })).toBe("missed");
  });

  it("no hook invalidates the query that never existed", () => {
    for (const f of [
      "src/app/[locale]/crm/call-center/_hooks/use-incoming-calls.ts",
      "src/app/[locale]/crm/call-center/_hooks/use-call-notes.ts",
    ]) {
      expect(src(f)).not.toContain('"call-center", "history"');
    }
  });
});

describe("CM-06 — the notes buffer never loses typing", () => {
  it("a save that returns while the operator keeps typing does not roll the field back", () => {
    let buf = initialNotesBuffer("c1", "");
    buf = { ...buf, value: "Пациент просит перенести" }; // typed
    // The debounce sends it; meanwhile the operator keeps typing.
    buf = { ...buf, value: "Пациент просит перенести на пятницу" };
    // The save of the first part succeeds and the cache gets it.
    buf = notesSaved(buf, "c1", "Пациент просит перенести");
    buf = reconcileNotesBuffer(buf, "c1", "Пациент просит перенести");
    expect(buf.value).toBe("Пациент просит перенести на пятницу");
  });

  it("with nothing unsaved, a newer server copy is shown", () => {
    const buf = reconcileNotesBuffer(initialNotesBuffer("c1", "a"), "c1", "a, b");
    expect(buf).toEqual({ callId: "c1", value: "a, b", lastSent: "a, b" });
  });

  it("another call shows its own notes", () => {
    const typing = { ...initialNotesBuffer("c1", ""), value: "draft" };
    expect(reconcileNotesBuffer(typing, "c2", "other")).toEqual({
      callId: "c2",
      value: "other",
      lastSent: "other",
    });
  });

  it("a save confirmed for another call changes nothing here", () => {
    const buf = { ...initialNotesBuffer("c2", "x"), value: "xy" };
    expect(notesSaved(buf, "c1", "old")).toBe(buf);
  });
});

describe("CM-11 — the caller panel", () => {
  const dayStart = new Date("2026-09-30T19:00:00Z"); // 01.10 00:00 Tashkent
  it("names the NEAREST visit still ahead, CONFIRMED included", () => {
    const rows = [
      { id: "past", status: "BOOKED", date: "2026-09-25T05:00:00Z" },
      { id: "done", status: "COMPLETED", date: "2026-10-01T04:00:00Z" },
      { id: "month", status: "BOOKED", date: "2026-11-01T05:00:00Z" },
      { id: "tomorrow", status: "CONFIRMED", date: "2026-10-02T05:00:00Z" },
      { id: "cancelled", status: "CANCELLED", date: "2026-10-01T09:00:00Z" },
    ];
    expect(pickNextAppointment(rows, dayStart)?.id).toBe("tomorrow");
    expect(pickNextAppointment([rows[0]!, rows[1]!], dayStart)).toBeNull();
  });

  it("the average check is over completed visits; the balance only where payments are recorded", () => {
    expect(averageCheckOf({ visitsTotal: 600_000_00, completedVisits: 3 })).toBe(200_000_00);
    expect(averageCheckOf({ visitsTotal: 0, completedVisits: 0 })).toBeNull();
    expect(knownBalanceOf({ tracksPayments: false, balance: 0 })).toBeNull();
    expect(knownBalanceOf({ tracksPayments: true, balance: -5 })).toBe(-5);
  });

  it("«Открыть» opens the visit drawer (`?ap=`), the only route there is", () => {
    expect(appointmentDrawerHref("ap_1")).toBe("/crm/appointments?ap=ap_1");
    expect(appointmentDrawerHref("ap_1", "uz")).toBe("/uz/crm/appointments?ap=ap_1");
    const active = src("src/app/[locale]/crm/call-center/_components/active-call.tsx");
    expect(active).not.toContain("/crm/appointments/${");
    const widget = src("src/app/[locale]/crm/call-center/_components/unconfirmed-widget.tsx");
    expect(widget).not.toContain("appointments?id=");
  });
});

describe("CM-08 / AC-16 — who works the call center and the Action Center", () => {
  it("the call operator works the Action Center; a nurse does not", () => {
    expect(ACTION_WORKER_ROLES).toContain("CALL_OPERATOR");
    expect(ACTION_READER_ROLES).toContain("CALL_OPERATOR");
    expect(canWorkActionCenter("CALL_OPERATOR")).toBe(true);
    expect(canWorkActionCenter("NURSE")).toBe(false);
    expect(canUseCallCenter("CALL_OPERATOR")).toBe(true);
    expect(canUseCallCenter("NURSE")).toBe(false);
    expect(canUseCallCenter("DOCTOR")).toBe(false);
  });

  it("the operator records the outcomes that keep or confirm the visit, never a cancel or a move", () => {
    for (const o of ["CONFIRMED", "CALLBACK", "NO_ANSWER"] as const) {
      expect(canRecordRiskOutcome("CALL_OPERATOR", o), o).toBe(true);
    }
    for (const o of ["REFUSED", "RETURN_LATER", "RESCHEDULED"] as const) {
      expect(canRecordRiskOutcome("CALL_OPERATOR", o), o).toBe(false);
      expect(canRecordRiskOutcome("RECEPTIONIST", o), o).toBe(true);
    }
    expect(canRecordRiskOutcome("DOCTOR", "REFUSED")).toBe(false);
    expect(canRecordRiskOutcome("NURSE", "CONFIRMED")).toBe(false);
  });

  it("the operator may confirm through the queue route and nothing else", () => {
    expect(canMutateStatus("CALL_OPERATOR")).toBe(false);
    expect(canUseQueueStatusRoute("CALL_OPERATOR", "CONFIRMED")).toBe(true);
    for (const target of ["WAITING", "NO_SHOW", "SKIPPED", "IN_PROGRESS", "COMPLETED"] as const) {
      expect(canUseQueueStatusRoute("CALL_OPERATOR", target), target).toBe(false);
    }
    expect(canUseQueueStatusRoute("NURSE", "CONFIRMED")).toBe(false);
    expect(canUseQueueStatusRoute("RECEPTIONIST", "WAITING")).toBe(true);
  });
});
