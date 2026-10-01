/**
 * The call-notes field's local buffer against the server copy (audit CM-06).
 *
 * The hook used to reset the field to `call.summary` whenever the summary
 * changed in the cache, and the autosave wrote into that cache the text it
 * had sent 800 ms earlier. An operator who kept typing while the save was in
 * flight watched the field jump back to the older text; whatever was typed
 * meanwhile was lost for good.
 *
 * The rules:
 *   - another call: show that call's notes;
 *   - unsaved typing, or a save still in flight (`value !== lastSent`), is
 *     never overwritten by the server copy;
 *   - with nothing unsaved, a newer server copy (another tab, another
 *     operator) is shown.
 *
 * Pure, so the rules are tested without React.
 */
export type NotesBuffer = {
  callId: string | null;
  /** What the field shows. */
  value: string;
  /** The text last confirmed saved for this call. */
  lastSent: string;
};

export function initialNotesBuffer(
  callId: string | null,
  serverSummary: string,
): NotesBuffer {
  return { callId, value: serverSummary, lastSent: serverSummary };
}

export function hasUnsavedNotes(buf: NotesBuffer): boolean {
  return buf.value !== buf.lastSent;
}

export function reconcileNotesBuffer(
  buf: NotesBuffer,
  callId: string | null,
  serverSummary: string,
): NotesBuffer {
  if (callId !== buf.callId) return initialNotesBuffer(callId, serverSummary);
  if (hasUnsavedNotes(buf)) return buf;
  if (serverSummary === buf.value) return buf;
  return { ...buf, value: serverSummary, lastSent: serverSummary };
}

/** A save of `sent` for `callId` succeeded. */
export function notesSaved(
  buf: NotesBuffer,
  callId: string,
  sent: string,
): NotesBuffer {
  if (buf.callId !== callId) return buf;
  return { ...buf, lastSent: sent };
}
