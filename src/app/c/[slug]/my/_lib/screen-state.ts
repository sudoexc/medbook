/**
 * "What should this list screen render?" — one rule for every Mini App list.
 *
 * The screens used to test `isLoading` then fall through to
 * `data?.length ? list : empty`. With `isError` unhandled a dropped
 * connection rendered the empty state, so «у вас нет записей» was shown to
 * patients who did have appointments — they concluded the clinic had
 * cancelled on them. Error must be its own branch, ahead of empty.
 *
 * Pure so the precedence is unit-testable without a DOM.
 */

export type ScreenState = "loading" | "error" | "empty" | "list";

export function resolveScreenState(params: {
  isLoading: boolean;
  isError: boolean;
  itemCount: number | null | undefined;
}): ScreenState {
  const { isLoading, isError, itemCount } = params;
  // Loading first: a refetch after an error shouldn't flash the error block.
  if (isLoading) return "loading";
  // Error before empty — "we couldn't check" is not "you have nothing".
  if (isError) return "error";
  if (!itemCount) return "empty";
  return "list";
}
