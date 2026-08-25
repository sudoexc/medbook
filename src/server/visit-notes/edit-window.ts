/**
 * The 24h post-finalization edit window, shared by:
 *   - PATCH /api/crm/visit-notes/[id]        (direct edits allowed inside)
 *   - POST  /api/crm/visit-notes/[id]/amendments (amendments allowed outside)
 *
 * The two gates are deliberately complementary: while the window is open the
 * doctor fixes the note in place (the printed artefact is re-rendered), and
 * once it closes the note becomes immutable and corrections switch to the
 * append-only amendment flow. Keeping the constant and the predicate in one
 * module is what guarantees the regimes can never overlap or leave a gap.
 */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True when the edit window of a FINALIZED note has closed. A finalized note
 * without `finalizedAt` is legacy/corrupt data — treat it as expired (locked),
 * the conservative reading for a legal document.
 */
export function isEditWindowExpired(
  finalizedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!finalizedAt) return true;
  return now.getTime() - finalizedAt.getTime() > EDIT_WINDOW_MS;
}
