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

/** How long the doctor's screen keeps «Идёт к вам: …» after the answer. */
export const STAFF_CALL_ACK_SHOWN_MS = 2 * 60 * 1000;

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

/** What the doctor's button shows for his latest call. */
export function doctorCallState(
  call: Pick<StaffCallView, "status" | "createdAt" | "ackedAt"> | null,
  now: number = Date.now(),
): "idle" | "calling" | "coming" {
  if (!call) return "idle";
  if (isStaffCallLive(call, now)) return "calling";
  if (
    call.status === "ACKED" &&
    call.ackedAt &&
    now - new Date(call.ackedAt).getTime() < STAFF_CALL_ACK_SHOWN_MS
  ) {
    return "coming";
  }
  return "idle";
}

/** The open-call cutoff for queries. */
export function staffCallOpenSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - STAFF_CALL_OPEN_MS);
}
