/**
 * «Перерыв» / «Обед» (owner request 09.10.2026): the doctor presses one
 * button any time; his TV shows «Врач на перерыве» / «Врач на обеде»
 * instead of the queue until he presses «Закончить», then «Врач снова
 * принимает» for a few seconds and the queue as it was.
 *
 * Pure: the API, the doctor's buttons, the TV and the tests share it.
 */

export const DOCTOR_PAUSE_KINDS = ["BREAK", "LUNCH"] as const;
export type DoctorPauseKind = (typeof DOCTOR_PAUSE_KINDS)[number];

/** A pause as the screens show it. */
export type DoctorPauseView = { id: string; kind: DoctorPauseKind; startedAt: string };

/** How long the TV says «Врач снова принимает» before the queue returns. */
export const DOCTOR_RESUMED_SHOWN_MS = 6_000;

export function parseDoctorPauseKind(value: unknown): DoctorPauseKind | null {
  return typeof value === "string" && (DOCTOR_PAUSE_KINDS as readonly string[]).includes(value)
    ? (value as DoctorPauseKind)
    : null;
}
