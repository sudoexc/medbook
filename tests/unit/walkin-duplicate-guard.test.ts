import { describe, expect, it } from "vitest";

/**
 * The clinic hit this in production: a doctor double-clicked «Добавить» and
 * the same patient landed in the live queue twice (Юсупова Лола, tickets
 * C-001 and C-002, «ждёт 6 мин» / «ждёт 5 мин»).
 *
 * The rule that fixes it lives inside the serializable queue transaction in
 * `registerWalkin`: before allocating a queue slot, refuse if this patient
 * already holds a live place with this doctor TODAY. These tests pin the
 * decision itself — the predicate and its boundaries — without a database:
 * a UI guard alone cannot fix it (a retried request or a second tab
 * reproduces the duplicate), so the predicate is what matters.
 */

type Row = {
  patientId: string;
  doctorId: string;
  queueStatus: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  date: Date;
};

const DAY_START = new Date("2026-09-23T00:00:00+05:00");
const DAY_END = new Date("2026-09-24T00:00:00+05:00");

/** Mirrors the `where` used by the guard in registerWalkin. */
function alreadyQueued(
  rows: Row[],
  patientId: string,
  doctorId: string,
): boolean {
  return rows.some(
    (r) =>
      r.patientId === patientId &&
      r.doctorId === doctorId &&
      (r.queueStatus === "WAITING" || r.queueStatus === "IN_PROGRESS") &&
      r.date >= DAY_START &&
      r.date < DAY_END,
  );
}

const waiting: Row = {
  patientId: "p1",
  doctorId: "d1",
  queueStatus: "WAITING",
  date: new Date("2026-09-23T08:20:00+05:00"),
};

describe("walk-in duplicate guard", () => {
  it("blocks the second press for a patient already waiting", () => {
    expect(alreadyQueued([waiting], "p1", "d1")).toBe(true);
  });

  it("blocks while the patient is being seen", () => {
    expect(
      alreadyQueued([{ ...waiting, queueStatus: "IN_PROGRESS" }], "p1", "d1"),
    ).toBe(true);
  });

  it("allows a genuine second visit later the same day", () => {
    // The morning visit is finished — coming back in the afternoon is a real
    // new place in the queue, not a double click.
    expect(
      alreadyQueued([{ ...waiting, queueStatus: "COMPLETED" }], "p1", "d1"),
    ).toBe(false);
    expect(
      alreadyQueued([{ ...waiting, queueStatus: "CANCELLED" }], "p1", "d1"),
    ).toBe(false);
  });

  it("allows the same patient to queue for a different doctor", () => {
    expect(alreadyQueued([waiting], "p1", "d2")).toBe(false);
  });

  it("ignores yesterday's queue", () => {
    expect(
      alreadyQueued(
        [{ ...waiting, date: new Date("2026-09-22T19:00:00+05:00") }],
        "p1",
        "d1",
      ),
    ).toBe(false);
  });

  it("does not block a different patient", () => {
    expect(alreadyQueued([waiting], "p2", "d1")).toBe(false);
  });
});
