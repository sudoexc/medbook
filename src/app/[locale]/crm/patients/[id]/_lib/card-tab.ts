/**
 * The patient card's tabs and the one a link opens (audit G6-09). Pure, so
 * the rule is tested without the page.
 */
export const PATIENT_CARD_TABS = [
  "overview",
  "visits",
  "cases",
  "medical",
  "documents",
  "payments",
  "communications",
] as const;

export type PatientCardTab = (typeof PATIENT_CARD_TABS)[number];

function isCardTab(value: string | null): value is PatientCardTab {
  return (PATIENT_CARD_TABS as readonly string[]).includes(value ?? "");
}

/**
 * `#case-<id>` (a case pill) opens «Случаи» so the tab can scroll to it;
 * otherwise `?tab=` names the tab, as the Telegram rail's «Ещё → Случаи /
 * Платежи / Документы» links do. Nothing, or an unknown name, leaves the
 * card on its overview.
 */
export function linkedCardTab(search: string, hash: string): PatientCardTab | null {
  if (hash.startsWith("#case-")) return "cases";
  const tab = new URLSearchParams(search).get("tab");
  return isCardTab(tab) ? tab : null;
}
