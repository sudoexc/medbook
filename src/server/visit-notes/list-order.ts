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
 */

export type ListSortField = "finalizedAt" | "createdAt";

export function listSortField(status: "DRAFT" | "FINALIZED" | undefined): ListSortField {
  return status === "FINALIZED" ? "finalizedAt" : "createdAt";
}

/** Newest first; a signed note without a signing time (legacy) goes last. */
export function listOrderBy(field: ListSortField) {
  return [{ [field]: { sort: "desc" as const, nulls: "last" as const } }, { id: "desc" as const }];
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

/** The rows after the cursor in `listOrderBy` order. */
export function keysetAfter(field: ListSortField, cursor: ListCursor) {
  if (cursor.value == null) {
    return { [field]: null, id: { lt: cursor.id } };
  }
  return {
    OR: [
      { [field]: { lt: cursor.value } },
      { [field]: cursor.value, id: { lt: cursor.id } },
      // Nulls sort last: every one of them comes after a dated row.
      { [field]: null },
    ],
  };
}
