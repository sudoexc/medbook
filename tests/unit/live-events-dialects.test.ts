/**
 * Regression guard for the two-generation event envelope trap
 * (`docs/architecture/REALTIME.md` §2).
 *
 * The shared SSE bus carries BOTH dialects:
 *   - v1 `AppEvent`       — `clinicId` on the top level (publishEventSafe)
 *   - v2 `EventEnvelope`  — `clinicId` inside `tenantScope` (outbox pumper)
 *
 * A consumer that parses with only one schema silently drops the other
 * generation — that's exactly how CRM missed every outbox-published event
 * (`visit-note.finalized`, `patient.arrived`, `nps.submitted`, …) while the
 * 60s polling masked the symptom. `parseLiveEvent` must therefore accept
 * both shapes and surface identical `type` + `clinicId` for each.
 */
import { describe, it, expect } from "vitest";

import { parseLiveEvent } from "@/hooks/use-live-events";

const CLINIC_ID = "clinic-abc";
const AT = "2026-08-20T09:00:00.000Z";

/** v1 — legacy fire-and-forget publish: clinicId on the top level. */
function v1Event(type: string, payload: Record<string, unknown>) {
  return { type, clinicId: CLINIC_ID, at: AT, payload };
}

/** v2 — outbox envelope: clinicId nested inside tenantScope. */
function v2Envelope(type: string, payload: Record<string, unknown>) {
  return {
    eventId: "evt-1",
    correlationId: "corr-1",
    at: AT,
    type,
    payload,
    actor: {
      role: "SYSTEM",
      userId: null,
      patientId: null,
      onBehalfOfPatientId: null,
      label: "worker",
    },
    surface: "WORKER",
    tenantScope: { clinicId: CLINIC_ID },
  };
}

describe("parseLiveEvent — dual-dialect envelope parsing", () => {
  it("accepts a v1 AppEvent and reads top-level clinicId", () => {
    const event = parseLiveEvent(
      v1Event("queue.updated", { appointmentId: "a1", queueStatus: "WAITING" }),
    );
    expect(event).not.toBeNull();
    expect(event?.type).toBe("queue.updated");
    expect(event?.clinicId).toBe(CLINIC_ID);
  });

  it("accepts a v2 EventEnvelope and lifts clinicId out of tenantScope", () => {
    const event = parseLiveEvent(
      v2Envelope("visit-note.finalized", {
        visitNoteId: "vn1",
        appointmentId: "a1",
      }),
    );
    expect(event).not.toBeNull();
    expect(event?.type).toBe("visit-note.finalized");
    expect(event?.clinicId).toBe(CLINIC_ID);
  });

  it("extracts identical type + clinicId from both dialects of the same event", () => {
    const payload = {
      appointmentId: "a1",
      patientId: "p1",
      patientName: "И. Каримов",
    };
    const fromV1 = parseLiveEvent(v1Event("patient.arrived", payload));
    const fromV2 = parseLiveEvent(v2Envelope("patient.arrived", payload));

    expect(fromV1).not.toBeNull();
    expect(fromV2).not.toBeNull();
    expect(fromV1?.type).toBe(fromV2?.type);
    expect(fromV1?.clinicId).toBe(fromV2?.clinicId);
    // The normalized v2 event is indistinguishable from a v1 event for
    // consumers — same typed payload shape, no tenantScope indirection.
    expect(fromV2?.payload).toMatchObject(payload);
  });

  it("parses an outbox-only type (nps.submitted) arriving as v2", () => {
    const event = parseLiveEvent(
      v2Envelope("nps.submitted", {
        appointmentId: "a1",
        patientId: "p1",
        score: 9,
      }),
    );
    expect(event).not.toBeNull();
    expect(event?.type).toBe("nps.submitted");
    expect(event?.clinicId).toBe(CLINIC_ID);
  });

  it("rejects malformed frames instead of throwing", () => {
    expect(parseLiveEvent(null)).toBeNull();
    expect(parseLiveEvent("not-json-object")).toBeNull();
    expect(parseLiveEvent({ type: "queue.updated" })).toBeNull(); // no clinicId anywhere
    expect(
      parseLiveEvent({ ...v1Event("unknown.type", {}), type: "unknown.type" }),
    ).toBeNull();
  });

  it("rejects a v2 envelope whose payload fails the per-type schema", () => {
    // `nps.submitted` requires an integer score 0..10 — the flatten step
    // re-validates against AppEventSchema so listeners keep the typed-payload
    // guarantee even for v2 frames.
    const event = parseLiveEvent(
      v2Envelope("nps.submitted", {
        appointmentId: "a1",
        patientId: "p1",
        score: 42,
      }),
    );
    expect(event).toBeNull();
  });
});
