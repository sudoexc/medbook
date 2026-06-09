/**
 * P1.2 — patient lab-results route.
 *
 * Mounted at `/c/[slug]/my/labs`. Lists the patient's REVIEWED lab results;
 * a doctor flipping a result to REVIEWED publishes `lab.result.reviewed`,
 * which invalidates this screen's query live (see `use-miniapp-live-events`).
 */
import { LabsScreen } from "../_components/labs-screen";

export default function LabsPage() {
  return <LabsScreen />;
}
