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

import {
  shouldDeliverToMiniApp,
  shouldDeliverV1ToMiniApp,
  MINIAPP_DELIVERABLE_TYPES,
} from "@/app/api/miniapp/events/route";

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

/**
 * Legacy v1 delivery — walk-in, operator chat, queue transitions and the TG
 * webhook all still publish via `publishEventSafe` (no v2 envelope). The
 * mini-app stream now forwards those too, but only patient-safe types whose
 * payload names an allowed patient. This guards against a v1 event that
 * carries a `patientId` for a *staff* concern (e.g. `call.incoming`) leaking.
 */
describe("shouldDeliverV1ToMiniApp", () => {
  const allowed = {
    clinicId: "c1",
    patientIds: new Set(["p_owner", "p_child", "p_spouse"]),
  };

  function makeV1(
    type: string,
    payload: Record<string, unknown>,
    clinicId = "c1",
  ): unknown {
    return { type, clinicId, at: "2026-06-01T10:00:00.000Z", payload };
  }

  it("delivers a walk-in appointment.created to the owner", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("appointment.created", {
          appointmentId: "a1",
          patientId: "p_owner",
          status: "WAITING",
        }),
        allowed,
      ),
    ).toBe(true);
  });

  it("delivers to a family member in the allow-set", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("appointment.created", { appointmentId: "a1", patientId: "p_child" }),
        allowed,
      ),
    ).toBe(true);
  });

  it("delivers an operator chat message (tg.message.new)", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("tg.message.new", {
          conversationId: "conv1",
          direction: "OUT",
          patientId: "p_owner",
        }),
        allowed,
      ),
    ).toBe(true);
  });

  it("DROPS a non-patient-facing type even when payload.patientId matches (leak guard)", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("call.incoming", { callId: "c", patientId: "p_owner" }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops when clinicId is wrong (cross-tenant guard)", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("appointment.created", { appointmentId: "a1", patientId: "p_owner" }, "c2"),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops when payload.patientId is a stranger", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("appointment.created", { appointmentId: "a1", patientId: "p_stranger" }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops when payload has no patientId (clinic-only v1 event)", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("queue.updated", { appointmentId: "a1", queueStatus: "WAITING" }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops a non-string payload.patientId without crashing", () => {
    expect(
      shouldDeliverV1ToMiniApp(
        makeV1("appointment.created", { appointmentId: "a1", patientId: 42 }),
        allowed,
      ),
    ).toBe(false);
  });

  it("drops malformed / non-object input", () => {
    expect(shouldDeliverV1ToMiniApp(null, allowed)).toBe(false);
    expect(shouldDeliverV1ToMiniApp("nope", allowed)).toBe(false);
    expect(shouldDeliverV1ToMiniApp({ type: 5 }, allowed)).toBe(false);
  });

  it("every deliverable type is a chat/appointment/patient concern (no call.* / cds.* / action.*)", () => {
    for (const t of MINIAPP_DELIVERABLE_TYPES) {
      expect(t.startsWith("call.")).toBe(false);
      expect(t.startsWith("cds.")).toBe(false);
      expect(t.startsWith("action.")).toBe(false);
      expect(t.startsWith("tg.takeover")).toBe(false);
    }
  });
});
