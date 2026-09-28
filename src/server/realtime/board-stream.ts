/**
 * Public waiting-room board stream — filter + projection.
 *
 * The TV board (`/tv`) and check-in kiosk (`/kiosk`) are *unauthenticated*
 * clinic-slug surfaces. They can't ride the CRM (`/api/events`) or patient
 * (`/api/miniapp/events`) SSE streams — those carry staff/patient PHI. This
 * module is the gatekeeper for a third, public stream:
 *
 *   1. `isBoardEvent` — only a small whitelist of queue/appointment *signals*
 *      is allowed onto a screen the whole waiting room can see. Everything
 *      else on the clinic bus (tg.message, payment.paid, lab results, …) is
 *      dropped.
 *   2. `projectBoardEvent` — even whitelisted events are re-projected to a
 *      fixed, per-type set of non-PHI scalar fields. Appointment payloads are
 *      `.passthrough()` and a future emitter could enrich them with a patient
 *      name; the projection guarantees a name can never reach the wire. The
 *      board route stays the single PHI-authoritative source — these events
 *      are just "something changed, refetch" pokes plus the public ticket /
 *      cabinet identifiers for the "now calling" banner.
 *
 * No appointment id reaches this stream (audit INF-10). It used to ride every
 * appointment.* event, the stream is anonymous, and the id was then the key
 * to `/api/queue/status/<id>`: a day of listening logged every visit with
 * initials, doctor and service. The screens only ever needed «refetch, and
 * whose doctor»; the one join they do (matching a call to a snapshot row,
 * Q-10) goes through `boardRowKey`, an HMAC the id cannot be recovered from.
 *
 * Both envelope shapes (v1 `{type,clinicId,at,payload}` and v2 `EventEnvelope`)
 * expose top-level `type` + `payload`, so these helpers read from `unknown`
 * defensively and work for either.
 */

import { boardRowKey } from "@/server/appointments/public-ticket";

/** Events safe to surface on a public waiting-room screen. */
export const BOARD_EVENT_TYPES = [
  "queue.updated",
  "queue.called",
  "appointment.created",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
] as const;

export type BoardEventType = (typeof BOARD_EVENT_TYPES)[number];

const BOARD_EVENT_SET = new Set<string>(BOARD_EVENT_TYPES);

/**
 * Scalar payload keys each event type may carry onto the public stream.
 *
 * Appointment and queue-change pokes carry the doctor only: the TVs and the
 * patient's `/q` page refetch their own snapshot and ignore other doctors'
 * signals. `queue.called` additionally carries what the «now calling» banner
 * shows: ticket, cabinet and `patientName`, which its emitters reduce to
 * initials via `initials()` (the same PHI-safe reduction the board route
 * serves), plus the opaque `rowKey` (see `boardRowKey`).
 */
const SAFE_PAYLOAD_KEYS: Record<BoardEventType, readonly string[]> = {
  "queue.updated": ["doctorId"],
  "queue.called": [
    "doctorId",
    "queueOrder",
    "ticketNumber",
    "patientName",
    "cabinetNumber",
    "calledAt",
    // "ru" | "uz", the language the board announces the call in (UX-06).
    // The hall hears that language anyway.
    "lang",
  ],
  "appointment.created": ["doctorId"],
  "appointment.statusChanged": ["doctorId"],
  "appointment.cancelled": ["doctorId"],
  "appointment.moved": ["doctorId"],
};

export type BoardEvent = {
  type: BoardEventType;
  payload: Record<string, string | number | boolean | null>;
};

function typeOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const t = (value as { type?: unknown }).type;
  return typeof t === "string" ? t : null;
}

/** True when the bus value is a whitelisted public-board event. */
export function isBoardEvent(value: unknown): boolean {
  const t = typeOf(value);
  return t !== null && BOARD_EVENT_SET.has(t);
}

/**
 * Re-project a whitelisted bus value into a minimal, PHI-safe board event.
 * Returns `null` when the value isn't a board event so the caller can drop it.
 */
export function projectBoardEvent(value: unknown): BoardEvent | null {
  const type = typeOf(value);
  if (type === null || !BOARD_EVENT_SET.has(type)) return null;

  const boardType = type as BoardEventType;
  const rawPayload = (value as { payload?: unknown }).payload;
  const payload: Record<string, string | number | boolean | null> = {};
  if (rawPayload && typeof rawPayload === "object") {
    const raw = rawPayload as Record<string, unknown>;
    for (const key of SAFE_PAYLOAD_KEYS[boardType]) {
      const v = raw[key];
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        payload[key] = v;
      }
    }
    if (boardType === "queue.called" && typeof raw.appointmentId === "string") {
      payload.rowKey = boardRowKey(raw.appointmentId);
    }
  }
  return { type: boardType, payload };
}
