/**
 * Call-outcome stamps (TZ-risk-outcomes §4) and the retired per-Action
 * endpoint (audit AC-19).
 *
 * `POST /api/crm/actions/[id]/outcome` let a DOCTOR cancel any visit of the
 * clinic, ran «Отказался» on any task type (a «нет канала» or low-NPS task
 * cancelled its visit too), and stamped the Action DONE even when the visit
 * refused the change. No screen called it any more: the risk list records
 * outcomes per appointment (`/api/crm/action-center/risk-today/outcome`,
 * covered by risk-today-outcome.test.ts). The route is gone; the stamping
 * rules it shared live on in `server/actions/outcome.ts` and are pinned here
 * without a route.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NO_ANSWER_MAX_ATTEMPTS,
  NO_ANSWER_SNOOZE_MIN,
  callbackOutlivesVisit,
  normalizeOutcomeInput,
  outcomeRecordedByTheMove,
  outcomeStamp,
  returnDayIsLater,
  type OutcomeInput,
} from "@/server/actions/outcome";
import * as actionSchemas from "@/server/schemas/action";

const NOW = new Date("2026-10-01T06:00:00.000Z"); // 11:00 Tashkent
/** The visit the risk row is about: today, three hours from now. */
const APPT_AT = new Date(NOW.getTime() + 3 * 60 * 60_000);

function input(over: Partial<OutcomeInput>): OutcomeInput {
  return { outcome: "CONFIRMED", note: null, callbackAt: null, ...over };
}

describe("AC-19 — the per-Action outcome endpoint is retired", () => {
  it("the route file no longer exists", () => {
    const route = join(
      process.cwd(),
      "src/app/api/crm/actions/[id]/outcome/route.ts",
    );
    expect(existsSync(route)).toBe(false);
  });

  it("its body schema is gone too; the risk-today schema stays", () => {
    expect("OutcomeActionSchema" in actionSchemas).toBe(false);
    expect(actionSchemas.RiskOutcomeSchema).toBeDefined();
  });
});

describe("outcome stamps", () => {
  it("CONFIRMED / REFUSED close the row with who and when", () => {
    for (const outcome of ["CONFIRMED", "REFUSED"] as const) {
      const stamp = outcomeStamp(
        { callAttempts: 0, severity: "high" },
        input({ outcome, note: outcome === "REFUSED" ? "передумал" : null }),
        "u_recept",
        NOW,
      );
      expect(stamp).toMatchObject({
        status: "DONE",
        doneAt: NOW,
        outcome,
        resolvedById: "u_recept",
      });
    }
  });

  // Audit AC-10: only the saved move records «Перенести».
  it("RESCHEDULED is recorded by the move, never as a call outcome", () => {
    expect(outcomeRecordedByTheMove("RESCHEDULED")).toBe(true);
    expect(outcomeRecordedByTheMove("CONFIRMED")).toBe(false);
  });

  it("CALLBACK before the visit snoozes the row until the call time", () => {
    const when = new Date(NOW.getTime() + 2 * 60 * 60_000);
    const i = input({ outcome: "CALLBACK", callbackAt: when, note: "занят" });
    expect(callbackOutlivesVisit(i, APPT_AT)).toBe(false);
    const stamp = outcomeStamp({ callAttempts: 0, severity: "high" }, i, "u", NOW);
    expect(stamp).toMatchObject({
      status: "SNOOZED",
      snoozeUntil: when,
      callbackAt: when,
      outcomeNote: "занят",
    });
  });

  // Audit AC-09: the risk row expires with the visit, so a later call moves
  // to a task of its own and this row is done.
  it("CALLBACK after the visit hands the call off and closes the row", () => {
    const when = new Date(APPT_AT.getTime() + 20 * 60 * 60_000);
    const i = input({ outcome: "CALLBACK", callbackAt: when });
    expect(callbackOutlivesVisit(i, APPT_AT)).toBe(true);
    const stamp = outcomeStamp({ callAttempts: 0, severity: "high" }, i, "u", NOW, {
      handedOff: true,
    });
    expect(stamp).toMatchObject({ status: "DONE", outcome: "CALLBACK" });
  });

  // Audit AC-09: «хочет прийти позже» schedules the call for 09:00 of the
  // return day, and only another day than the visit's own.
  it("RETURN_LATER is due at 09:00 of the return day, never on the visit's own day", () => {
    const picked = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
    const normalized = normalizeOutcomeInput(
      input({ outcome: "RETURN_LATER", callbackAt: picked }),
    );
    // 09:00 Tashkent (04:00Z) on the picked day.
    expect(normalized.callbackAt!.toISOString().slice(11)).toBe("04:00:00.000Z");
    expect(returnDayIsLater(normalized, APPT_AT)).toBe(true);
    expect(
      returnDayIsLater(input({ outcome: "RETURN_LATER", callbackAt: APPT_AT }), APPT_AT),
    ).toBe(false);
  });

  it("NO_ANSWER counts the attempt, snoozes, and escalates at the cap", () => {
    const stamp = outcomeStamp(
      { callAttempts: NO_ANSWER_MAX_ATTEMPTS - 1, severity: "medium" },
      input({ outcome: "NO_ANSWER" }),
      "u",
      NOW,
    );
    expect(stamp.callAttempts).toBe(NO_ANSWER_MAX_ATTEMPTS);
    expect(stamp.status).toBe("SNOOZED");
    expect((stamp.snoozeUntil as Date).getTime()).toBe(
      NOW.getTime() + NO_ANSWER_SNOOZE_MIN * 60_000,
    );
    expect(stamp.severity).toBe("high");
  });
});
