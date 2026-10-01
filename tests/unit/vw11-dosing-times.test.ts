/**
 * Audit VW-11 — every new prescription row started with no time of day and
 * a blue bell «Напоминания пациенту включены», while the finalize bridge
 * turns reminders on only for a row with at least one time of day. The
 * patient got the course in the Mini App and never a reminder.
 *
 * Pinned:
 *   1. A dosing text that says how often gives the matching slots
 *      («2 раза в день» → утро и вечер); one that does not, or is not a
 *      daily schedule (as needed, a cap, weekly), gives none.
 *   2. A line adopted from the conclusion text starts with those slots.
 *   3. The bell has a third state, «no time chosen, no reminders», by the
 *      bridge's own rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  dailyFrequencyFromText,
  reminderStateOf,
  timesOfDayFromText,
} from "@/lib/catalogs/dosing-times";
import { parseConclusionPrescriptions } from "@/lib/catalogs/conclusion-parse";
import { buildBridgeSchedule, DEFAULT_SLOT_TIMES } from "@/server/workers/visit-note-handout";
import { draftFromParsed } from "@/app/[locale]/doctor/reception/_components/parsed-from-text-card";

describe("VW-11: times of day from the dosing text", () => {
  it.each([
    ["по 1 таблетке 2 раза в день", ["MORNING", "EVENING"]],
    ["по 1 таб. 1 раз в день", ["MORNING"]],
    ["по 1 таблетке 2–3 раза в день, курс 10 дней", ["MORNING", "EVENING"]],
    ["3 р/д после еды", ["MORNING", "NOON", "EVENING"]],
    ["по 1 капсуле 4 раза в сутки", ["MORNING", "NOON", "EVENING", "NIGHT"]],
    ["дважды в день", ["MORNING", "EVENING"]],
    ["раз в день", ["MORNING"]],
    ["утром и на ночь", ["MORNING", "NIGHT"]],
    ["по 1 таб вечером", ["EVENING"]],
    ["kuniga 2 marta ovqatdan keyin", ["MORNING", "EVENING"]],
    ["ertalab va kechqurun", ["MORNING", "EVENING"]],
  ])("«%s»", (text, expected) => {
    expect(timesOfDayFromText(text)).toEqual(expected);
  });

  it.each([
    "по 1 таб.",
    "1 раз в неделю",
    "через день",
    "при головной боли: по 1 таблетке до 3 раз в день",
    "не более 2 раз в день",
    "по требованию",
    "однократно в/м",
    "6 раз в день",
    "",
  ])("no schedule for «%s»", (text) => {
    expect(timesOfDayFromText(text)).toEqual([]);
  });

  it("the first text that says anything decides", () => {
    expect(timesOfDayFromText(null, "1 таб.", "2 раза в день")).toEqual([
      "MORNING",
      "EVENING",
    ]);
    expect(dailyFrequencyFromText("по 1 таблетке 2 раза в день")).toBe(2);
  });
});

describe("VW-11: a line adopted from the conclusion is reminded", () => {
  it("«Мидокалм 150 мг — по 1 таблетке 2 раза в день» gets morning and evening", () => {
    const [parsed] = parseConclusionPrescriptions(
      "Мидокалм 150 мг — по 1 таблетке 2 раза в день, курс 10 дней.",
    );
    expect(parsed).toBeTruthy();
    const draft = draftFromParsed(parsed!);
    expect(draft.timesOfDay).toEqual(["MORNING", "EVENING"]);
    expect(draft.remindPatient).toBe(true);
    // ...which the bridge turns into a real reminder schedule.
    const schedule = buildBridgeSchedule(draft, DEFAULT_SLOT_TIMES, new Date());
    expect(schedule.times).toEqual(["08:00", "19:00"]);
  });

  it("an as-needed line gets no schedule", () => {
    const [parsed] = parseConclusionPrescriptions(
      "При головной боли — Нурофен по 1 таблетке, не более 3 раз в день.",
    );
    expect(parsed).toBeTruthy();
    expect(draftFromParsed(parsed!).timesOfDay).toEqual([]);
  });
});

describe("VW-11: the bell says what will happen", () => {
  it("on / no times / off, by the bridge's rule", () => {
    expect(reminderStateOf({ remindPatient: true, timesOfDay: ["MORNING"] })).toBe("on");
    expect(reminderStateOf({ remindPatient: true, timesOfDay: [] })).toBe("noTimes");
    expect(reminderStateOf({ remindPatient: false, timesOfDay: ["MORNING"] })).toBe("off");
  });

  it("the constructor row shows the no-times state", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/[locale]/doctor/reception/_components/prescription-constructor.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("reminderStateOf(row)");
    expect(src).toContain('t("rx.remindNoTimes")');
  });
});
