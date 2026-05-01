/**
 * Phase 10 — `suggestReassignments` unit coverage.
 *
 * Trigger logic: overdue (>=20 delay) OR (>=15 delay AND >=10 wait).
 * Eligibility: candidate must be in `eligibleDoctorIds` and have
 *              `capacityRemainingMin >= 30`. Picks lightest by remainingTodayMin.
 */
import { describe, it, expect } from "vitest";

import {
  suggestReassignments,
  type DoctorLoad,
} from "@/lib/ai/reassign-engine";

const BUSY: DoctorLoad = {
  doctorId: "d_busy",
  delayMin: 25,
  remainingTodayMin: 240,
  capacityRemainingMin: 0,
};
const FREE: DoctorLoad = {
  doctorId: "d_free",
  delayMin: 0,
  remainingTodayMin: 60,
  capacityRemainingMin: 120,
};
const FREEER: DoctorLoad = {
  doctorId: "d_freeer",
  delayMin: 0,
  remainingTodayMin: 30,
  capacityRemainingMin: 120,
};

describe("suggestReassignments", () => {
  it("no overdue & no overload → empty list", () => {
    const out = suggestReassignments({
      loads: [
        { ...BUSY, delayMin: 0 },
        FREE,
      ],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 5,
          eligibleDoctorIds: ["d_busy", "d_free"],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("overdue (>=20) triggers reassignment to lightest eligible", () => {
    const out = suggestReassignments({
      loads: [BUSY, FREE, FREEER],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 0,
          eligibleDoctorIds: ["d_busy", "d_free", "d_freeer"],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.toDoctorId).toBe("d_freeer"); // 30 < 60
    expect(out[0]!.reason).toBe("overdue");
    expect(out[0]!.fromDoctorId).toBe("d_busy");
    expect(out[0]!.estDelaySaved).toBe(20); // 25 - 5
  });

  it("overload trigger (delay 15..19 + wait>=10) → reason 'overloaded'", () => {
    const out = suggestReassignments({
      loads: [
        { ...BUSY, delayMin: 17 },
        FREE,
      ],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 12,
          eligibleDoctorIds: ["d_busy", "d_free"],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("overloaded");
    expect(out[0]!.estDelaySaved).toBe(12); // 17 - 5
  });

  it("skips when no eligible candidate has enough capacity", () => {
    const tightFree: DoctorLoad = { ...FREE, capacityRemainingMin: 10 };
    const out = suggestReassignments({
      loads: [BUSY, tightFree],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 0,
          eligibleDoctorIds: ["d_busy", "d_free"],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("skips when waiting appointment has no eligible doctors other than source", () => {
    const out = suggestReassignments({
      loads: [BUSY, FREE],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 0,
          eligibleDoctorIds: ["d_busy"], // only the overdue source
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("does not pick a doctor missing from `loads`", () => {
    const out = suggestReassignments({
      loads: [BUSY], // FREE not in loads
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 0,
          eligibleDoctorIds: ["d_busy", "d_free"],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("multiple waiting appointments emit one candidate each when triggered", () => {
    const out = suggestReassignments({
      loads: [BUSY, FREE],
      waiting: [
        {
          appointmentId: "a1",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 5,
          eligibleDoctorIds: ["d_free"],
        },
        {
          appointmentId: "a2",
          doctorId: "d_busy",
          serviceId: "s1",
          waitMin: 0,
          eligibleDoctorIds: ["d_free"],
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.appointmentId).sort()).toEqual(["a1", "a2"]);
  });
});
