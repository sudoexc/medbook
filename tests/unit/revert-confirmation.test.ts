/**
 * Audit DC-07: the round arrow next to «Уже был» reopened a completed visit
 * in one click. The server then un-signs the conclusion (FINALIZED → DRAFT)
 * and turns off the patient's medication reminders, so a stray click took
 * the signature off a medical document silently.
 *
 * Reverting a COMPLETED visit from the schedule now asks first, inline (the
 * kiosk card's «Отключить» pattern), with the consequences spelled out. The
 * other reverts only move a patient between queue states and stay one click.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  revertTargetFor,
  revertUnsignsConclusion,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

const ALL: AppointmentStatus[] = [
  "BOOKED",
  "CONFIRMED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
];

describe("which reverts need an explicit confirmation", () => {
  it("reopening a completed visit does (it un-signs the conclusion)", () => {
    expect(revertTargetFor("COMPLETED")).toBe("IN_PROGRESS");
    expect(revertUnsignsConclusion("COMPLETED")).toBe(true);
  });

  it("no other status does", () => {
    for (const s of ALL.filter((x) => x !== "COMPLETED")) {
      expect(revertUnsignsConclusion(s)).toBe(false);
    }
  });
});

describe("the confirmation text", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (lang: string) =>
    JSON.parse(
      readFileSync(path.join(root, `src/messages/${lang}.json`), "utf8"),
    ) as { doctor: { myDay: { schedule: Record<string, string> } } };

  for (const lang of ["ru", "uz"]) {
    it(`${lang}: says what happens, offers yes and cancel, no dashes`, () => {
      const schedule = read(lang).doctor.myDay.schedule;
      for (const key of [
        "revertConfirm",
        "revertConfirmYes",
        "revertConfirmCancel",
      ]) {
        expect(schedule[key], key).toBeTruthy();
        expect(schedule[key]).not.toMatch(/[—–]/);
      }
    });
  }

  it("ru names both consequences: the signature and the reminders", () => {
    const text = read("ru").doctor.myDay.schedule.revertConfirm;
    expect(text).toMatch(/подпис/);
    expect(text).toMatch(/напоминан/);
  });
});

describe("the schedule row wires it", () => {
  // Components are not rendered in this node-only suite; this pins that the
  // «Уже был» row derives its confirmation from the shared rule instead of
  // calling the revert straight from the arrow's onClick.
  const source = readFileSync(
    path.resolve(
      __dirname,
      "../../src/app/[locale]/doctor/my-day/_components/schedule-card.tsx",
    ),
    "utf8",
  );

  it("passes a confirm prompt for a revert that un-signs", () => {
    expect(source).toContain("revertUnsignsConclusion(entry.appointmentStatus)");
    expect(source).toContain('t("schedule.revertConfirm")');
  });

  it("the arrow only opens the prompt when one is given", () => {
    expect(source).toContain(
      "onClick={() => (confirm ? setAsking(true) : onClick())}",
    );
  });
});
