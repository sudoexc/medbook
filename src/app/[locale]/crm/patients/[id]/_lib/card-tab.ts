/**
 * The tab a link opens on the patient card (audit G6-09). Pure, so the rule
 * is tested without the page. The tab list itself lives in
 * `patient-card-tabs.ts`, the one the tab bar renders.
 */
import {
  tabFromParam,
  type TabKey,
} from "../_components/patient-card-tabs";

export type PatientCardTab = TabKey;

/**
 * `#case-<id>` (a case pill) opens «Случаи» so the tab can scroll to it;
 * otherwise `?tab=` names the tab, as the Telegram rail's «Ещё → Случаи /
 * Платежи / Документы» links do. Nothing, or an unknown name, leaves the
 * card on its overview.
 */
export function linkedCardTab(search: string, hash: string): PatientCardTab | null {
  if (hash.startsWith("#case-")) return "cases";
  return tabFromParam(new URLSearchParams(search).get("tab"));
}
