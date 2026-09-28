/**
 * Audit Q-10: the waiting-room TVs announce and show the patient who was
 * actually called.
 *
 * «Вызвать из очереди» at the desk and «следующий пациент» in the cabinet
 * first finish the visit in progress and a moment later start the next one.
 * The TVs took the name from their board snapshot's `current`, which is
 * refreshed 400 ms after the event: at the instant of the call it still held
 * the patient who had just left. The hall heard «Иванов И., пройдите в
 * кабинет 3» while Петрова was being called.
 *
 * Both screens now resolve the call through `resolveCallDisplay`: the event's
 * own initials and ticket first, then only the snapshot row of the SAME
 * appointment, and never a stale `current` of somebody else.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  parseQueueCalledPayload,
  resolveCallDisplay,
} from "@/lib/queue-call";
import { projectBoardEvent } from "@/server/realtime/board-stream";
import { boardRowKey } from "@/server/appointments/public-ticket";

beforeAll(() => {
  // Board row keys are HMACs over the app secret (audit INF-10).
  process.env.APP_SECRET = "test-app-secret";
});

/**
 * The snapshot at the instant of the call: Иванов is still `current`. Row
 * ids are opaque board row keys, never appointment ids (INF-10).
 */
const STALE_CURRENT = {
  id: "rk_ivanov",
  fullName: "Иванов И.",
  ticketNumber: "A-006",
};
const WAITING_PETROVA = {
  id: "rk_petrova",
  fullName: "Петрова М.",
  ticketNumber: "A-007",
};

describe("parseQueueCalledPayload", () => {
  it("keeps the called patient's initials from the event", () => {
    const call = parseQueueCalledPayload({
      rowKey: "rk_petrova",
      doctorId: "doc_1",
      ticketNumber: "A-007",
      patientName: "Петрова М.",
      cabinetNumber: "3",
      calledAt: "2026-09-23T05:00:00.000Z",
      queueOrder: 7,
    });
    expect(call).toEqual({
      rowKey: "rk_petrova",
      doctorId: "doc_1",
      ticketNumber: "A-007",
      patientName: "Петрова М.",
      cabinetNumber: "3",
      calledAt: "2026-09-23T05:00:00.000Z",
      queueOrder: 7,
    });
  });

  it("reads a sparse payload as nulls, never as the string «undefined»", () => {
    const call = parseQueueCalledPayload({ rowKey: "a", doctorId: "d" });
    expect(call.patientName).toBeNull();
    expect(call.ticketNumber).toBeNull();
    expect(call.cabinetNumber).toBeNull();
    expect(parseQueueCalledPayload(undefined).rowKey).toBe("");
  });

  it("survives the public board stream projection (patientName is whitelisted)", () => {
    const ev = projectBoardEvent({
      type: "queue.called",
      payload: {
        appointmentId: "apt_petrova",
        doctorId: "doc_1",
        patientId: "p_secret",
        patientName: "Петрова М.",
        ticketNumber: "A-007",
      },
    });
    const call = parseQueueCalledPayload(ev?.payload);
    expect(call.patientName).toBe("Петрова М.");
    expect(ev?.payload).not.toHaveProperty("patientId");
    expect(ev?.payload).not.toHaveProperty("appointmentId");
  });

  it("the stream's row key joins the board snapshot row of the same appointment (INF-10)", () => {
    // Board routes serve `id: boardRowKey(appointmentId)`; the stream
    // projects the called appointment to the same key, never the id.
    const ev = projectBoardEvent({
      type: "queue.called",
      payload: { appointmentId: "apt_petrova", doctorId: "doc_1" },
    });
    const call = parseQueueCalledPayload(ev?.payload);
    expect(call.rowKey).toBe(boardRowKey("apt_petrova"));
    expect(call.rowKey).not.toContain("apt_petrova");
    const shown = resolveCallDisplay(
      call,
      [
        { ...STALE_CURRENT, id: boardRowKey("apt_ivanov") },
        { ...WAITING_PETROVA, id: boardRowKey("apt_petrova") },
      ],
      "3",
    );
    expect(shown.patientName).toBe("Петрова М.");
  });
});

describe("resolveCallDisplay", () => {
  it("«завершить + вызвать следующего»: the event's name wins over the stale current", () => {
    const shown = resolveCallDisplay(
      {
        rowKey: "rk_petrova",
        patientName: "Петрова М.",
        ticketNumber: "A-007",
        cabinetNumber: "3",
      },
      [STALE_CURRENT, WAITING_PETROVA],
      "3",
    );
    expect(shown).toEqual({
      patientName: "Петрова М.",
      ticketNumber: "A-007",
      cabinet: "3",
    });
  });

  it("without initials in the event, falls back to the snapshot row of the same appointment", () => {
    const shown = resolveCallDisplay(
      {
        rowKey: "rk_petrova",
        patientName: null,
        ticketNumber: null,
        cabinetNumber: null,
      },
      [STALE_CURRENT, WAITING_PETROVA],
      "3",
    );
    expect(shown).toEqual({
      patientName: "Петрова М.",
      ticketNumber: "A-007",
      cabinet: "3",
    });
  });

  it("never reads someone else's `current` as the called patient", () => {
    const shown = resolveCallDisplay(
      {
        rowKey: "rk_petrova",
        patientName: null,
        ticketNumber: null,
        cabinetNumber: null,
      },
      [STALE_CURRENT],
      "3",
    );
    // Nothing trustworthy: the voice falls back to «Следующий пациент».
    expect(shown.patientName).toBe("");
    expect(shown.ticketNumber).toBe("");
    expect(shown.cabinet).toBe("3");
  });

  it("handles an empty board (first seconds after the TV boots)", () => {
    const shown = resolveCallDisplay(
      {
        rowKey: "rk_petrova",
        patientName: "Петрова М.",
        ticketNumber: "A-007",
        cabinetNumber: "3",
      },
      [undefined, null],
      undefined,
    );
    expect(shown).toEqual({
      patientName: "Петрова М.",
      ticketNumber: "A-007",
      cabinet: "3",
    });
  });
});

describe("both TV screens use the event, not the snapshot's current name", () => {
  const read = (p: string) =>
    readFileSync(path.join(process.cwd(), p), "utf8");

  for (const file of ["src/app/tv/page.tsx", "src/app/tv/d/[token]/page.tsx"]) {
    it(`${file} resolves the call through resolveCallDisplay`, () => {
      const src = read(file);
      expect(src).toContain("resolveCallDisplay(");
      expect(src).toContain("announce(shown.patientName");
      // The old reads: whoever the snapshot had as current.
      expect(src).not.toMatch(/announce\([^)]*current\?\.fullName/);
      expect(src).not.toMatch(/patientName:\s*[^,\n]*current\?\.fullName/);
    });
  }
});
