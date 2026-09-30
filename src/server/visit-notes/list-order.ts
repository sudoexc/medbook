/**
 * Order and paging of the doctor's conclusions list (audit DC-11).
 *
 * The list was ordered by `updatedAt` and paged with a Prisma id cursor.
 * `updatedAt` moves while the doctor scrolls: a draft's autosave, a signed
 * note's in-window correction, a background re-render. A row that moved
 * between two pages came twice (a duplicate React key) or never, and a
 * conclusion signed weeks ago jumped to the top after a small fix. On top
 * of that the next-page cursor was the first row NOT sent, and the next
 * page started after it: one conclusion lost per page.
 *
 * Now:
 *   - signed conclusions by the moment they were signed, drafts (and the
 *     unfiltered admin list) by when they were opened: values an edit does
 *     not touch;
 *   - the id breaks ties, so the order is total;
 *   - the cursor carries the last row's own values, and the next page is
 *     everything strictly after that pair (keyset paging), so a row that
 *     changes in between is neither repeated nor skipped.
 *
 * The two fields are not built alike. `finalizedAt` is nullable (a legacy
 * signed note may lack it), so its order places nulls and its keyset has
 * null branches. `createdAt` is NOT NULL, and Prisma accepts only a bare
 * direction and a non-null value for it: `{ sort, nulls }` or
 * `{ createdAt: null }` fail validation before the query runs, which broke
 * the drafts tab. The return types are Prisma's own so the compiler, not a
 * mocked client, catches a shape the column does not take.
 */
import type { Prisma } from "@/generated/prisma/client";

export type ListSortField = "finalizedAt" | "createdAt";

export function listSortField(status: "DRAFT" | "FINALIZED" | undefined): ListSortField {
  return status === "FINALIZED" ? "finalizedAt" : "createdAt";
}

/** Newest first; a signed note without a signing time (legacy) goes last. */
export function listOrderBy(field: ListSortField): Prisma.VisitNoteOrderByWithRelationInput[] {
  return field === "finalizedAt"
    ? [{ finalizedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];
}

export type ListCursor = { value: Date | null; id: string };

/** «<epoch ms or n>:<id>»: opaque to the client, which only hands it back. */
export function encodeListCursor(value: Date | null, id: string): string {
  return `${value ? value.getTime() : "n"}:${id}`;
}

/**
 * The cursor's pair, or `{ id }` alone for a cursor in the old id-only
 * shape (a page loaded before this change), whose values the caller reads
 * from the row. Null for garbage.
 */
export function decodeListCursor(raw: string): ListCursor | { id: string } | null {
  const at = raw.indexOf(":");
  if (at < 0) return raw.trim() ? { id: raw.trim() } : null;
  const head = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!id) return null;
  if (head === "n") return { value: null, id };
  if (!/^\d+$/.test(head)) return null;
  return { value: new Date(Number(head)), id };
}

/**
 * The rows after the cursor in `listOrderBy` order, or null when the cursor
 * cannot be placed in it: a value-less cursor on `createdAt`, which no row
 * of that order produces (a hand-edited URL, a cursor from the other tab).
 */
export function keysetAfter(
  field: ListSortField,
  cursor: ListCursor,
): Prisma.VisitNoteWhereInput | null {
  const { value, id } = cursor;
  if (field === "createdAt") {
    if (value == null) return null;
    return {
      OR: [{ createdAt: { lt: value } }, { createdAt: value, id: { lt: id } }],
    };
  }
  if (value == null) return { finalizedAt: null, id: { lt: id } };
  return {
    OR: [
      { finalizedAt: { lt: value } },
      { finalizedAt: value, id: { lt: id } },
      // Nulls sort last: every one of them comes after a dated row.
      { finalizedAt: null },
    ],
  };
}
