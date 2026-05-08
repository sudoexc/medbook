/**
 * Phase 16 Wave 3 — Medications dashboard route.
 *
 * Mounted at `/c/[slug]/my/medications`. The hourly medication-reminder
 * push lands here (deeplink `/my/medications` → resolved against the
 * Mini App slug by the layout). The screen reads the open reminders +
 * the active schedule and lets the patient confirm each tick.
 */
import { MedicationsScreen } from "../_components/medications-screen";

export default function MedicationsPage() {
  return <MedicationsScreen />;
}
