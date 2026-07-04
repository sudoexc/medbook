/**
 * Public board SSE filter + projection coverage.
 *
 * This is the PHI gate for the unauthenticated `/api/c/[slug]/queue/events`
 * stream: only whitelisted queue/appointment signals may reach a screen the
 * whole waiting room sees, and even those are stripped to non-PHI scalars.
 * These tests pin both halves so a future emitter that enriches an appointment
 * payload with a patient name can't silently leak it onto the wire.
 */
import { describe, it, expect } from "vitest";

import {
  isBoardEvent,
  projectBoardEvent,
} from "@/server/realtime/board-stream";

describe("isBoardEvent", () => {
  it("accepts whitelisted queue/appointment signals", () => {
    expect(isBoardEvent({ type: "queue.updated" })).toBe(true);
    expect(isBoardEvent({ type: "queue.called" })).toBe(true);
    expect(isBoardEvent({ type: "appointment.created" })).toBe(true);
    expect(isBoardEvent({ type: "appointment.statusChanged" })).toBe(true);
  });

  it("rejects PHI-bearing / unrelated events", () => {
    expect(isBoardEvent({ type: "tg.message.new" })).toBe(false);
    expect(isBoardEvent({ type: "payment.paid" })).toBe(false);
    expect(isBoardEvent({ type: "lab.result.received" })).toBe(false);
    expect(isBoardEvent({ type: "patient.arrived" })).toBe(false);
  });

  it("rejects malformed bus values", () => {
    expect(isBoardEvent(null)).toBe(false);
    expect(isBoardEvent("queue.updated")).toBe(false);
    expect(isBoardEvent({})).toBe(false);
    expect(isBoardEvent({ type: 42 })).toBe(false);
  });
});

describe("projectBoardEvent", () => {
  it("strips patientId but passes the whitelisted initials-only patientName", () => {
    const projected = projectBoardEvent({
      type: "appointment.statusChanged",
      clinicId: "c1",
      payload: {
        appointmentId: "a1",
        doctorId: "d1",
        patientId: "p1",
        patientName: "Иванов Иван", // hypothetical passthrough enrichment
        status: "WAITING",
        previousStatus: "BOOKED",
      },
    });
    expect(projected).not.toBeNull();
    expect(projected!.type).toBe("appointment.statusChanged");
    expect(projected!.payload).toEqual({
      appointmentId: "a1",
      doctorId: "d1",
      // patientName is whitelisted for the call overlay — emitters send
      // initials only (see queue.called emit sites).
      patientName: "Иванов Иван",
      status: "WAITING",
      previousStatus: "BOOKED",
    });
    expect("patientId" in projected!.payload).toBe(false);
    expect("patientName" in projected!.payload).toBe(true);
  });

  it("preserves the public call identifiers for the now-calling banner", () => {
    const projected = projectBoardEvent({
      type: "queue.called",
      payload: {
        appointmentId: "a1",
        doctorId: "d1",
        queueOrder: 7,
        ticketNumber: "D-007",
        cabinetNumber: "3",
        calledAt: "2026-06-25T09:00:00.000Z",
      },
    });
    expect(projected!.payload).toEqual({
      appointmentId: "a1",
      doctorId: "d1",
      queueOrder: 7,
      ticketNumber: "D-007",
      cabinetNumber: "3",
      calledAt: "2026-06-25T09:00:00.000Z",
    });
  });

  it("returns null for non-board events", () => {
    expect(projectBoardEvent({ type: "tg.message.new", payload: {} })).toBeNull();
    expect(projectBoardEvent(null)).toBeNull();
  });

  it("tolerates a missing/empty payload", () => {
    const projected = projectBoardEvent({ type: "queue.updated" });
    expect(projected).toEqual({ type: "queue.updated", payload: {} });
  });
});
