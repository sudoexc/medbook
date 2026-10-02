/**
 * SUPER_ADMIN «enter clinic» questions, shared by the CRM topbar switcher and
 * /admin/clinics (Phase 19 W4: a logged reason of 4+ chars and a mode).
 *
 * The mode question used to read «OK = VIEW_ONLY, Cancel = WRITE», so the
 * answer that means «never mind» (Cancel, Esc, closing the dialog, or a
 * browser that suppresses repeated dialogs and returns false) entered the
 * clinic with mutations allowed (audit CM-21). Writing now needs an explicit
 * OK; every other answer is read-only.
 *
 * Takes the dialogs as a parameter so the rule is testable without a DOM.
 */

export type ClinicEntryMode = "WRITE" | "VIEW_ONLY";

export type ClinicEntryAnswer =
  | { kind: "enter"; reason: string; mode: ClinicEntryMode }
  | { kind: "cancelled" }
  | { kind: "invalid"; message: string };

type Dialogs = {
  prompt: (message: string, defaultValue?: string) => string | null;
  confirm: (message: string) => boolean;
};

export const CLINIC_ENTRY_MIN_REASON = 4;

export function askClinicEntry(dialogs: Dialogs): ClinicEntryAnswer {
  const reason = dialogs.prompt(
    "Reason for entering this clinic (≥4 chars). This is logged.",
    "",
  );
  if (reason === null) return { kind: "cancelled" };
  const trimmed = reason.trim();
  if (trimmed.length < CLINIC_ENTRY_MIN_REASON) {
    return { kind: "invalid", message: "Reason must be at least 4 characters" };
  }
  const write = dialogs.confirm(
    "OK = WRITE (mutations allowed).\nCancel = VIEW_ONLY (read-only).",
  );
  return { kind: "enter", reason: trimmed, mode: write ? "WRITE" : "VIEW_ONLY" };
}
