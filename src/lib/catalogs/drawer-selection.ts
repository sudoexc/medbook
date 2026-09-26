/**
 * Which drug card the prescription drawer shows.
 *
 * The drawer lists search results and shows one card beside them. When the
 * selection left the results it snapped back to the first row, which is
 * right after a new search and badly wrong after a click in «Чем заменить»:
 * the analogue is almost never among the results, so the doctor clicked
 * «Диклофенак» and read the contraindications of «Дифенгидрамин +
 * кеторолак» (audit CT-01). An opened analogue is now a selection of its
 * own that no refresh of the results replaces.
 */
export function drawerSelection<T extends { id: string }>(
  rows: readonly T[],
  selectedId: string | null,
  openedAnalogue: T | null,
): {
  /** The card to show now. */
  selected: T | null;
  /** The id the drawer should hold; differs from `selectedId` when it must move. */
  selectedId: string | null;
} {
  const inRows = selectedId ? rows.find((r) => r.id === selectedId) : undefined;
  if (inRows) return { selected: inRows, selectedId };
  if (openedAnalogue && openedAnalogue.id === selectedId) {
    return { selected: openedAnalogue, selectedId };
  }
  const first = rows[0] ?? null;
  return { selected: first, selectedId: first?.id ?? null };
}
