/**
 * Tests for the DOCTOR_OVERLOAD detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - queue >= threshold → one payload + alternative doctors
 *   - queue below threshold → no payload
 *   - dedupe — repeated runs yield identical payloads (sorted by doctorId)
 */
import { describe, it, expect } from "vitest";

import { detectDoctorOverload } from "@/server/actions/detectors/doctor-overload";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Doctor = {
  id: string;
  nameRu: string;
  specializationRu: string;
  isActive: boolean;
};
type Appt = { doctorId: string; status: string };

function makePrisma(state: { doctors: Doctor[]; appts: Appt[] }) {
  return {
    doctor: { findMany: async () => state.doctors },
    appointment: { findMany: async () => state.appts },
  } as never;
}

const now = new Date("2026-05-06T11:00:00.000Z");

describe("detectDoctorOverload", () => {
  it("returns [] when there are no active doctors", async () => {
    const out = await detectDoctorOverload(
      makePrisma({ doctors: [], appts: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("returns [] when no doctor reaches threshold", async () => {
    const out = await detectDoctorOverload(
      makePrisma({
        doctors: [
          {
            id: "d1",
            nameRu: "Иванов",
            specializationRu: "Кардиолог",
            isActive: true,
          },
        ],
        appts: [{ doctorId: "d1", status: "WAITING" }],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload when a doctor's queue meets threshold + finds alternatives", async () => {
    const threshold = DEFAULT_CONFIG.doctorOverloadQueueLength;
    const appts: Appt[] = [];
    for (let i = 0; i < threshold; i++) appts.push({ doctorId: "d1", status: "WAITING" });
    appts.push({ doctorId: "d2", status: "WAITING" }); // alt doctor: queue=1

    const out = await detectDoctorOverload(
      makePrisma({
        doctors: [
          {
            id: "d1",
            nameRu: "Иванов",
            specializationRu: "Кардиолог",
            isActive: true,
          },
          {
            id: "d2",
            nameRu: "Петров",
            specializationRu: "Кардиолог",
            isActive: true,
          },
          {
            id: "d3",
            nameRu: "Сидоров",
            specializationRu: "Невролог", // wrong specialty → not an alt
            isActive: true,
          },
        ],
        appts,
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.doctorId).toBe("d1");
    expect(out[0]?.queueLength).toBe(threshold);
    expect(out[0]?.alternativeDoctorIds).toEqual(["d2"]);
  });

  it("dedupe — repeated runs yield identical payloads (stable sort)", async () => {
    const threshold = DEFAULT_CONFIG.doctorOverloadQueueLength;
    const appts: Appt[] = [];
    for (let i = 0; i < threshold; i++) appts.push({ doctorId: "d1", status: "WAITING" });
    for (let i = 0; i < threshold; i++) appts.push({ doctorId: "d2", status: "WAITING" });
    const state = {
      doctors: [
        {
          id: "d2",
          nameRu: "Петров",
          specializationRu: "Невролог",
          isActive: true,
        },
        {
          id: "d1",
          nameRu: "Иванов",
          specializationRu: "Кардиолог",
          isActive: true,
        },
      ],
      appts,
    };
    const a = await detectDoctorOverload(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectDoctorOverload(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(a.map((p) => p.doctorId)).toEqual(["d1", "d2"]);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
});
