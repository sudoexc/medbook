/**
 * Phase A.4 — EventEnvelope v2 schema unit tests.
 *
 * Pure schema + meta-lookup tests; no DB. The outbox helper, pumper, and
 * the confirm-via-outbox path are covered separately by integration tests
 * (Phase A.8) that need a real Postgres because of FOR UPDATE SKIP LOCKED.
 */
import { describe, it, expect } from "vitest";

import {
  EventEnvelopeSchema,
  getEventMeta,
  isEventEnvelope,
  parseEnvelope,
} from "@/server/realtime/envelope";

const baseEnvelope = {
  eventId: "evt-1",
  correlationId: "corr-1",
  at: "2026-06-01T07:00:00.000+00:00",
  type: "appointment.statusChanged" as const,
  payload: { appointmentId: "appt-1", status: "CONFIRMED" },
  actor: {
    role: "RECEPTIONIST" as const,
    userId: "user-1",
    patientId: null,
    onBehalfOfPatientId: null,
    label: "Иванов И.И. (RECEPTIONIST)",
  },
  surface: "CRM" as const,
  tenantScope: {
    clinicId: "clinic-abc",
    appointmentId: "appt-1",
  },
};

describe("EventEnvelopeSchema", () => {
  it("accepts a well-formed v2 envelope", () => {
    const parsed = EventEnvelopeSchema.safeParse(baseEnvelope);
    expect(parsed.success).toBe(true);
  });

  it("requires a tenantScope.clinicId", () => {
    const bad = {
      ...baseEnvelope,
      tenantScope: { appointmentId: "appt-1" } as never,
    };
    const parsed = EventEnvelopeSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown event type", () => {
    const bad = { ...baseEnvelope, type: "no.such.event" as never };
    const parsed = EventEnvelopeSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown actor role", () => {
    const bad = {
      ...baseEnvelope,
      actor: { ...baseEnvelope.actor, role: "BOSS" as never },
    };
    const parsed = EventEnvelopeSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown surface", () => {
    const bad = { ...baseEnvelope, surface: "FAX_MACHINE" as never };
    const parsed = EventEnvelopeSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("parseEnvelope throws on bad input", () => {
    expect(() => parseEnvelope({ junk: true })).toThrow();
  });

  it("isEventEnvelope narrows correctly", () => {
    expect(isEventEnvelope(baseEnvelope)).toBe(true);
    expect(isEventEnvelope({})).toBe(false);
    expect(isEventEnvelope(null)).toBe(false);
  });
});

describe("getEventMeta", () => {
  it("returns auditable=true for appointment.statusChanged", () => {
    const meta = getEventMeta("appointment.statusChanged");
    expect(meta.auditable).toBe(true);
    expect(meta.severity).toBe("info");
  });

  it("returns the default (non-auditable, info) for queue.updated", () => {
    const meta = getEventMeta("queue.updated");
    expect(meta.auditable).toBe(false);
    expect(meta.severity).toBe("info");
  });

  it("flags notification.failed as a warning", () => {
    const meta = getEventMeta("notification.failed");
    expect(meta.auditable).toBe(true);
    expect(meta.severity).toBe("warning");
  });

  it("flags cds.override.recorded as auditable warning", () => {
    const meta = getEventMeta("cds.override.recorded");
    expect(meta.auditable).toBe(true);
    expect(meta.severity).toBe("warning");
  });
});
