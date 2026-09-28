/**
 * Public board SSE filter + projection coverage.
 *
 * This is the PHI gate for the unauthenticated `/api/c/[slug]/queue/events`
 * stream: only whitelisted queue/appointment signals may reach a screen the
 * whole waiting room sees, and even those are stripped to non-PHI scalars.
 * These tests pin both halves so a future emitter that enriches an appointment
 * payload with a patient name can't silently leak it onto the wire.
 */
import { beforeAll, describe, it, expect } from "vitest";

import {
  isBoardEvent,
  projectBoardEvent,
} from "@/server/realtime/board-stream";
import { boardRowKey } from "@/server/appointments/public-ticket";

beforeAll(() => {
  process.env.APP_SECRET = "test-app-secret";
});

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
  it("an appointment poke carries the doctor only: no appointment id, no patient, no status (INF-10)", () => {
    const projected = projectBoardEvent({
      type: "appointment.created",
      clinicId: "c1",
      payload: {
        appointmentId: "a1",
        doctorId: "d1",
        patientId: "p1",
        patientName: "Иванов Иван", // hypothetical passthrough enrichment
        serviceName: "ЭЭГ",
        status: "BOOKED",
        previousStatus: null,
      },
    });
    expect(projected).toEqual({
      type: "appointment.created",
      payload: { doctorId: "d1" },
    });
  });

  it("every appointment.* and queue.updated poke drops the appointment id", () => {
    for (const type of [
      "appointment.created",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
      "queue.updated",
    ]) {
      const projected = projectBoardEvent({
        type,
        payload: { appointmentId: "a1", doctorId: "d1", queueOrder: 3 },
      });
      expect(projected!.payload).toEqual({ doctorId: "d1" });
      expect(JSON.stringify(projected)).not.toContain("a1");
    }
  });

  it("keeps the public call identifiers for the now-calling banner, with an opaque row key", () => {
    const projected = projectBoardEvent({
      type: "queue.called",
      payload: {
        appointmentId: "a1",
        doctorId: "d1",
        patientId: "p1",
        queueOrder: 7,
        ticketNumber: "D-007",
        // Emitters reduce the name to initials; it is on the whitelist.
        patientName: "Иванов И.",
        cabinetNumber: "3",
        calledAt: "2026-06-25T09:00:00.000Z",
      },
    });
    expect(projected!.payload).toEqual({
      doctorId: "d1",
      queueOrder: 7,
      ticketNumber: "D-007",
      patientName: "Иванов И.",
      cabinetNumber: "3",
      calledAt: "2026-06-25T09:00:00.000Z",
      rowKey: boardRowKey("a1"),
    });
    expect("appointmentId" in projected!.payload).toBe(false);
    expect("patientId" in projected!.payload).toBe(false);
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
