/** The patient card's tabs, in display order. */

export type TabKey =
  | "overview"
  | "visits"
  | "cases"
  | "medical"
  | "documents"
  | "payments"
  | "communications";

export const TAB_ORDER: { key: TabKey; tKey: string }[] = [
  { key: "overview", tKey: "overview" },
  { key: "visits", tKey: "visits" },
  { key: "cases", tKey: "cases" },
  { key: "medical", tKey: "medical" },
  { key: "documents", tKey: "documents" },
  { key: "payments", tKey: "payments" },
  { key: "communications", tKey: "communications" },
];

/** The tab a `?tab=` deep link names, or null for none / an unknown one. */
export function tabFromParam(raw: string | null): TabKey | null {
  return TAB_ORDER.find((tb) => tb.key === raw)?.key ?? null;
}
