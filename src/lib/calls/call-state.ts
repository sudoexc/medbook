/**
 * One reading of a Call row's lifecycle, shared by the SIP webhook, the
 * operator's «Завершить» / «Пропуск», the stale-call sweep, the missed-calls
 * list and the sidebar badge (audit CM-01, CM-07, CM-10, CM-13).
 *
 * The rules:
 *   - A call is over once it has `endedAt` (or a terminal status). Nothing
 *     reopens it: an `answered` that arrives after the hangup used to flip
 *     a finished call back to «В разговоре» forever.
 *   - A call nobody answered is MISSED, and an inbound one also takes
 *     `direction = MISSED`: every missed counter (sidebar badge, dashboard,
 *     analytics) filters on the direction, and a ringing → hangup sequence
 *     used to stay IN, so the badge read 0 while the patient hung up.
 *   - `durationSec` is the talk time, from `answeredAt` to the end. It used
 *     to start at the first ring, so an unanswered call had 40 seconds of
 *     «разговора» and the funnel counted it as a conversation. A call
 *     without a known answer moment has no duration (null), never a guess.
 *
 * Client-safe: no server imports, so the call-center screen reads the same
 * helpers.
 */

export type CallStatusValue = "RINGING" | "ANSWERED" | "ENDED" | "MISSED";
export type CallDirectionValue = "IN" | "OUT" | "MISSED";

/** Tag an operator sets on a missed call once the patient was called back. */
export const CALLED_BACK_TAG = "called_back";

/**
 * A RINGING call with no hangup for this long is closed as missed by the
 * sweep: a lost hangup left a «ghost» first in every operator's queue.
 */
export const RINGING_STALE_MIN = 10;

/**
 * An answered call with no hangup for this long is closed by the sweep. Its
 * talk time is unknown, so it gets no duration.
 */
export const ANSWERED_STALE_MIN = 4 * 60;

type Dateish = Date | string | null;

function toDate(v: Dateish): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export type CallLifecycleRow = {
  direction: CallDirectionValue;
  status: CallStatusValue | null;
  answeredAt: Dateish;
  endedAt: Dateish;
  tags: readonly string[];
};

export function isCallOver(
  row: Pick<CallLifecycleRow, "status" | "endedAt">,
): boolean {
  return (
    row.endedAt !== null || row.status === "ENDED" || row.status === "MISSED"
  );
}

/**
 * Somebody picked the call up. `tags: ["answered"]` is the marker rows kept
 * before the status column existed.
 */
export function wasCallAnswered(
  row: Pick<CallLifecycleRow, "status" | "answeredAt" | "tags">,
): boolean {
  return (
    row.answeredAt !== null ||
    row.status === "ANSWERED" ||
    row.status === "ENDED" ||
    row.tags.includes("answered")
  );
}

/**
 * «Пропуск» (and the reception's reject) may close this call as missed: it
 * is still live and nobody has picked it up. An answered call is a
 * conversation that happened; closing it as missed put it on the missed
 * badge and the call back list and dropped its talk time (the PBX hangup
 * that follows finds it over). The webhook ignores a «missed» on an
 * answered call for the same reason; «Завершить» is the way to close it.
 */
export function canMarkCallMissed(
  row: Pick<CallLifecycleRow, "status" | "answeredAt" | "endedAt" | "tags">,
): boolean {
  return !isCallOver(row) && !wasCallAnswered(row);
}

/** Seconds of conversation, or null when the answer moment is unknown. */
export function talkSeconds(answeredAt: Dateish, endedAt: Date): number | null {
  const from = toDate(answeredAt);
  if (!from) return null;
  return Math.max(0, Math.round((endedAt.getTime() - from.getTime()) / 1000));
}

export type CallCloseUpdate = {
  endedAt: Date;
  status: "ENDED" | "MISSED";
  /** Set only when an inbound call becomes a missed one. */
  direction?: "MISSED";
  durationSec: number | null;
};

/**
 * Nobody answered. Only an inbound call becomes a «пропущенный»: an outbound
 * call the patient did not pick up is not one the clinic has to return.
 */
export function missedUpdate(
  row: Pick<CallLifecycleRow, "direction">,
  endedAt: Date,
): CallCloseUpdate {
  return {
    endedAt,
    status: "MISSED",
    durationSec: null,
    ...(row.direction === "IN" ? { direction: "MISSED" as const } : {}),
  };
}

/** The PBX hung up: answered → ENDED with the talk time, otherwise missed. */
export function hangupUpdate(
  row: Pick<CallLifecycleRow, "direction" | "status" | "answeredAt" | "tags">,
  endedAt: Date,
): CallCloseUpdate {
  if (wasCallAnswered(row)) {
    return {
      endedAt,
      status: "ENDED",
      durationSec: talkSeconds(row.answeredAt, endedAt),
    };
  }
  return missedUpdate(row, endedAt);
}

/**
 * The operator pressed «Завершить»: the conversation happened (without a
 * PBX nobody else can say so), so the call is ENDED. The talk time is known
 * only when the PBX reported the answer.
 */
export function operatorEndUpdate(
  row: Pick<CallLifecycleRow, "answeredAt">,
  endedAt: Date,
): CallCloseUpdate {
  return {
    endedAt,
    status: "ENDED",
    durationSec: talkSeconds(row.answeredAt, endedAt),
  };
}

export function isCalledBack(tags: readonly string[]): boolean {
  return tags.includes(CALLED_BACK_TAG);
}

/**
 * Missed calls of a clinic day that still wait for a call back: the sidebar
 * badge and the «Пропущенные» list count the same rows, so a call marked
 * «Перезвонили» leaves both.
 */
export function pendingMissedCallsWhere(from: Date, toExclusive: Date) {
  return {
    direction: "MISSED" as const,
    createdAt: { gte: from, lt: toExclusive },
    NOT: { tags: { has: CALLED_BACK_TAG } },
  };
}
