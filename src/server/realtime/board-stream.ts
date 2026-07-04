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
 *      fixed set of non-PHI scalar fields. Appointment payloads are
 *      `.passthrough()` and a future emitter could enrich them with a patient
 *      name; the projection guarantees a name can never reach the wire. The
 *      board route stays the single PHI-authoritative source — these events
 *      are just "something changed, refetch" pokes plus the public ticket /
 *      cabinet identifiers for the "now calling" banner.
 *
 * Both envelope shapes (v1 `{type,clinicId,at,payload}` and v2 `EventEnvelope`)
 * expose top-level `type` + `payload`, so these helpers read from `unknown`
 * defensively and work for either.
 */

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
 * Scalar payload keys allowed onto the public stream. Deliberately excludes
 * `patientId` and full names — the board joins by `appointmentId`. The one
 * name-shaped exception is `patientName`: `queue.called` emitters populate it
 * via `initials()` only, the same PHI-safe reduction the board route itself
 * serves, so the "now calling" banner can greet without an extra fetch.
 */
const SAFE_PAYLOAD_KEYS = [
  "appointmentId",
  "doctorId",
  "queueStatus",
  "previousStatus",
  "status",
  "queueOrder",
  "ticketNumber",
  "patientName",
  "cabinetNumber",
  "calledAt",
] as const;

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

  const rawPayload = (value as { payload?: unknown }).payload;
  const payload: Record<string, string | number | boolean | null> = {};
  if (rawPayload && typeof rawPayload === "object") {
    for (const key of SAFE_PAYLOAD_KEYS) {
      const v = (rawPayload as Record<string, unknown>)[key];
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        payload[key] = v;
      }
    }
  }
  return { type: type as BoardEventType, payload };
}
