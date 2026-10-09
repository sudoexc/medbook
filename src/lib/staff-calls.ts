/**
 * «Позвать регистратуру» (owner request 09.10.2026): the doctor presses one
 * button in his cabinet; every reception screen (the desk PC and the iPad)
 * shows «Вас зовёт врач …» full screen until someone answers «Иду»; the
 * doctor then sees who is coming and the other reception screens close
 * the call, so two people do not run.
 *
 * Pure: the API routes, the doctor's button, the reception overlay and the
 * unit tests share it.
 */

/** Who presses the button. */
export const STAFF_CALL_CALLER_ROLES = ["DOCTOR"] as const;

/**
 * Whose screens the call takes over: the desk, the nurse and the clinic's
 * administrators (owner, 09.10.2026: «во всех акках ресепшна и тд»).
 */
export const STAFF_CALL_ALERT_ROLES = ["RECEPTIONIST", "NURSE", "ADMIN"] as const;

/** Who may answer «Иду»: everyone it rings for, and the platform admin. */
export const STAFF_CALL_ANSWER_ROLES = ["RECEPTIONIST", "NURSE", "ADMIN", "SUPER_ADMIN"] as const;

/** An unanswered call stops ringing after this long; the doctor may call again. */
export const STAFF_CALL_OPEN_MS = 10 * 60 * 1000;

/**
 * How long the doctor's button says «Идёт к вам: …», counted from when his
 * screen learned of the answer, before it is the plain yellow button again
 * (owner, 09.10.2026: two minutes «висит долго»). The toast with the name
 * stays a little longer.
 */
export const STAFF_CALL_ACK_SHOWN_MS = 3_000;

/**
 * How long the server keeps handing the doctor his answered call, so the
 * news reaches a screen that polls late or reconnects (not how long it is
 * shown).
 */
export const STAFF_CALL_ACK_KEPT_MS = 2 * 60 * 1000;

/** The reception overlay rings again this often while a call is open. */
export const STAFF_CALL_RING_EVERY_MS = 20 * 1000;

export type StaffCallStatus = "OPEN" | "ACKED" | "CANCELLED";

/** A call as the screens show it. */
export type StaffCallView = {
  id: string;
  doctorId: string;
  doctorName: string;
  cabinet: string | null;
  status: StaffCallStatus;
  ackedByName: string | null;
  createdAt: string;
  ackedAt: string | null;
};

export function isStaffCallAlertRole(role: string | null | undefined): boolean {
  return (STAFF_CALL_ALERT_ROLES as readonly string[]).includes(role ?? "");
}

export function canAnswerStaffCall(role: string | null | undefined): boolean {
  return (STAFF_CALL_ANSWER_ROLES as readonly string[]).includes(role ?? "");
}

/** Still ringing: open and younger than STAFF_CALL_OPEN_MS. */
export function isStaffCallLive(
  call: Pick<StaffCallView, "status" | "createdAt">,
  now: number = Date.now(),
): boolean {
  return call.status === "OPEN" && now - new Date(call.createdAt).getTime() < STAFF_CALL_OPEN_MS;
}

/**
 * What the doctor's button shows for his latest call: still ringing, or
 * answered. `seenAckAt` is when this screen first saw the answer (its own
 * clock, only compared with itself): «Идёт к вам» lasts
 * STAFF_CALL_ACK_SHOWN_MS from then.
 */
export function doctorCallState(
  call: Pick<StaffCallView, "status" | "createdAt"> | null,
  serverNow: number,
  seenAckAt: number | null = null,
  localNow: number = Date.now(),
): "idle" | "calling" | "coming" {
  if (!call) return "idle";
  if (isStaffCallLive(call, serverNow)) return "calling";
  if (call.status === "ACKED" && seenAckAt !== null && localNow - seenAckAt < STAFF_CALL_ACK_SHOWN_MS) {
    return "coming";
  }
  return "idle";
}

/** The open-call cutoff for queries. */
export function staffCallOpenSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - STAFF_CALL_OPEN_MS);
}
