/**
 * Phase 17 Wave 3 — Mini App account-deletion page.
 *
 * Mounted at `/c/[slug]/my/account/delete`. The patient sees a clear
 * before/after summary and types their phone number to confirm. After
 * submission the deletion job is queued for execution in 90 days; the
 * patient can cancel from the same page.
 */
import { AccountDeleteScreen } from "../../_components/account-delete-screen";

export default function AccountDeletePage() {
  return <AccountDeleteScreen />;
}
