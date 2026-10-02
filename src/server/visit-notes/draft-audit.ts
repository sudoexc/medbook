/**
 * Audit G1-12: one `visit_note.update` row per editing session of a draft,
 * not one per autosave.
 *
 * The reception editor PATCHes a single field on every 1.5 s debounce, so a
 * visit with fifty autosaves wrote fifty one-field rows and buried role
 * changes and cancellations under them. While a note has never been signed
 * nothing in it has reached the patient or the card yet, and the signature
 * itself is audited (`visit_note.finalize`) with the signed result kept as a
 * revision. So for such a draft the first save of a session writes the row
 * (who started editing which note, and when) and the saves that follow
 * within the window ride on it.
 *
 * A signed or reopened note is never coalesced: every correction there
 * carries its own revision pair and keeps its own row.
 */
import type { prisma } from "@/lib/prisma";

/** A gap longer than this starts a new editing session with its own row. */
export const DRAFT_AUDIT_WINDOW_MS = 30 * 60 * 1000;

type AuditLogDb = Pick<typeof prisma, "auditLog">;

/**
 * Has `actorId` already got a `visit_note.update` row for this note within
 * the window? True means this autosave needs no row of its own. Without an
 * actor there is nothing to coalesce by, so the row is written.
 */
export async function draftEditAuditedRecently(
  db: AuditLogDb,
  input: { visitNoteId: string; actorId: string | null; now?: Date },
): Promise<boolean> {
  if (!input.actorId) return false;
  const now = input.now ?? new Date();
  try {
    const row = await db.auditLog.findFirst({
      where: {
        action: "visit_note.update",
        entityType: "VisitNote",
        entityId: input.visitNoteId,
        actorId: input.actorId,
        createdAt: { gte: new Date(now.getTime() - DRAFT_AUDIT_WINDOW_MS) },
      },
      select: { id: true },
    });
    return row !== null;
  } catch (e) {
    // Same posture as audit() itself: the journal never fails an autosave.
    // A lookup that failed writes the row, so nothing goes unrecorded.
    console.error("[audit:draft-session]", e);
    return false;
  }
}
