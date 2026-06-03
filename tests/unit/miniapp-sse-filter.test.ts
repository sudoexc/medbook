/**
 * Phase M3 — patient-scoped SSE filter unit tests.
 *
 * The filter sits between the clinic-wide event bus and the patient's
 * EventSource stream. Wrong patient = drop; wrong clinic = drop; no patient
 * scope at all = drop. Family relatives in the allow-set are equally
 * deliverable to the owner.
 */
import { describe, expect, it } from "vitest";

import type { EventEnvelope } from "@/server/realtime/envelope";

import { shouldDeliverToMiniApp } from "@/app/api/miniapp/events/route";

function makeEnvelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "ev_1",
    correlationId: "cor_1",
    causedByEventId: null,
    actor: {
      role: "PATIENT",
      userId: null,
      patientId: "p_owner",
      onBehalfOfPatientId: null,
      label: "patient:p_owner",
    },
    surface: "MINIAPP",
    tenantScope: {
      clinicId: "c1",
      doctorId: null,
      patientId: "p_owner",
      appointmentId: null,
    },
    at: "2026-06-01T10:00:00.000Z",
    type: "patient.profileUpdated",
    payload: { patientId: "p_owner", changedFields: ["fullName"] },
    ...over,
  } as EventEnvelope;
}

describe("shouldDeliverToMiniApp", () => {
  const allowed = {
    clinicId: "c1",
    patientIds: new Set(["p_owner", "p_child", "p_spouse"]),
  };

  it("delivers when tenantScope.patientId matches the owner", () => {
    expect(shouldDeliverToMiniApp(makeEnvelope(), allowed)).toBe(true);
  });

  it("delivers when tenantScope.patientId matches a family member", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: {
            clinicId: "c1",
            patientId: "p_child",
          } as EventEnvelope["tenantScope"],
        }),
        allowed,
      ),
    ).toBe(true);
  });

  it("delivers when only payload.patientId matches (no tenant patient hint)", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: {
            clinicId: "c1",
            appointmentId: "apt_1",
          } as EventEnvelope["tenantScope"],
          payload: { patientId: "p_spouse" },
        }),
        allowed,
      ),
    ).toBe(true);
  });

  it("drops when tenantScope.clinicId is wrong (cross-tenant leak guard)", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: {
            clinicId: "c2",
            patientId: "p_owner",
          } as EventEnvelope["tenantScope"],
        }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops when no patient scope is present at all (clinic-only event)", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: { clinicId: "c1" } as EventEnvelope["tenantScope"],
          payload: { doctorId: "d_1" },
        }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops when tenant patientId is stranger AND payload.patientId is missing", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: {
            clinicId: "c1",
            patientId: "p_stranger",
          } as EventEnvelope["tenantScope"],
          payload: { foo: "bar" },
        }),
        allowed,
      ),
    ).toBe(false);
  });

  it("tolerates non-string payload.patientId without crashing", () => {
    expect(
      shouldDeliverToMiniApp(
        makeEnvelope({
          tenantScope: { clinicId: "c1" } as EventEnvelope["tenantScope"],
          payload: { patientId: 42 },
        }),
        allowed,
      ),
    ).toBe(false);
  });
});
