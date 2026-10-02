/**
 * Which ringing calls are news to the operator (audit CM-27). Pure, so the
 * rule is tested without the page.
 *
 * The first loaded list is the baseline: calls already ringing when the
 * page opened are on screen, not news. After it every id the queue has not
 * held before is announced, however the list learned of it (an SSE
 * invalidation or the minute poll). The old check compared the size of the
 * seen set with the list's length, which only held when another call left
 * the queue in the same refetch, so a new call almost never raised a toast.
 *
 * `seen` is null until the baseline is taken. The returned set holds only
 * the ids still ringing, so it never grows past the queue.
 */
export function diffRingingCalls(
  seen: ReadonlySet<string> | null,
  ids: readonly string[],
): { seen: Set<string>; fresh: string[] } {
  const next = new Set(ids);
  if (seen === null) return { seen: next, fresh: [] };
  return { seen: next, fresh: ids.filter((id) => !seen.has(id)) };
}
