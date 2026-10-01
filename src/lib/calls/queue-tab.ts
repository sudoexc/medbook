/**
 * Which list the call center's left column shows (audit CM-13). Pure, so
 * the rule is tested without the page.
 */
export type QueueTab = "incoming" | "missed";

/**
 * An explicit `?tab=` wins; the action center's old «Упущенные звонки» link
 * (`?intent=missed-calls`) opens the missed list. Otherwise the ringing
 * calls come first, and with none ringing the missed calls still waiting for
 * a call back are shown: the sidebar badge that brought the operator here
 * counts exactly those.
 */
export function pickQueueTab(input: {
  tabParam: string | null;
  intentParam: string | null;
  ringingCount: number;
  pendingMissedCount: number;
}): QueueTab {
  if (input.tabParam === "missed" || input.tabParam === "incoming") {
    return input.tabParam;
  }
  if (input.intentParam === "missed-calls") return "missed";
  if (input.ringingCount === 0 && input.pendingMissedCount > 0) return "missed";
  return "incoming";
}
