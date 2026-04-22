import { NotificationsPageClient } from "./_components/notifications-page-client";

/**
 * /crm/notifications — Phase 3a.
 *
 * Thin server shell; client component owns filter state (URL-synced tab),
 * data-fetching via TanStack Query and dialogs. See `docs/TZ.md` §6.9
 * and progress log Phase 3a for the full contract.
 */
export default function NotificationsPage() {
  return <NotificationsPageClient />;
}
