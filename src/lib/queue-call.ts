/**
 * What the waiting-room TVs (`/tv`, `/tv/d/<token>`) announce and show for a
 * `queue.called` signal (audit Q-10).
 *
 * The screens used to take the name from their board snapshot's `current`.
 * That snapshot refreshes 400 ms after the event (debounced refetch), and
 * «Вызвать из очереди» / «следующий пациент» first completes the visit in
 * progress and a moment later starts the next one: at the instant of the call
 * `current` was still the previous patient. The hall heard «Иванов И.,
 * пройдите в кабинет 3» while Петрова was the one being called.
 *
 * The event itself carries the called patient's initials (`patientName`, on
 * the public stream's whitelist) and ticket, so those come first. The
 * snapshot is only a fallback, and only the row of the SAME appointment:
 * a stale `current` of someone else is never read as the called patient.
 * With nothing to go on the voice says the ticket or «Следующий пациент».
 *
 * Pure and client-safe: shared by both TV hooks and pages.
 */

export interface QueueCallFields {
  appointmentId: string;
  doctorId: string;
  ticketNumber: string | null;
  cabinetNumber: string | null;
  /** Initials of the called patient, as the emitters reduce them. */
  patientName: string | null;
  calledAt: string | null;
  queueOrder: number | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Read a `queue.called` SSE payload defensively (any field may be absent). */
export function parseQueueCalledPayload(
  p: Record<string, unknown> | null | undefined,
): QueueCallFields {
  const payload = p ?? {};
  return {
    appointmentId: str(payload.appointmentId) ?? "",
    doctorId: str(payload.doctorId) ?? "",
    ticketNumber: str(payload.ticketNumber),
    cabinetNumber: str(payload.cabinetNumber),
    patientName: str(payload.patientName),
    calledAt: str(payload.calledAt),
    queueOrder: typeof payload.queueOrder === "number" ? payload.queueOrder : null,
  };
}

/** A board row that might be the called appointment. */
export interface CallBoardRow {
  /** Appointment id; rows without one never match. */
  id?: string | null;
  fullName: string;
  ticketNumber: string | null;
}

export interface CallDisplay {
  patientName: string;
  ticketNumber: string;
  cabinet: string;
}

/**
 * Name, ticket and cabinet for the call takeover and the voice line. Board
 * rows are the called doctor's `current` and `waiting` entries; only the one
 * whose id is the called appointment counts.
 */
export function resolveCallDisplay(
  call: Pick<
    QueueCallFields,
    "appointmentId" | "patientName" | "ticketNumber" | "cabinetNumber"
  >,
  rows: ReadonlyArray<CallBoardRow | null | undefined>,
  boardCabinet: string | null | undefined,
): CallDisplay {
  const same = call.appointmentId
    ? rows.find((r) => r?.id && r.id === call.appointmentId)
    : undefined;
  return {
    patientName: call.patientName ?? same?.fullName ?? "",
    ticketNumber: call.ticketNumber ?? same?.ticketNumber ?? "",
    cabinet: call.cabinetNumber ?? boardCabinet ?? "",
  };
}
