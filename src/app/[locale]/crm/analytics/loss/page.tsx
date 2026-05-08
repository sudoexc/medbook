import { LossPageClient } from "./_components/loss-page-client";

/**
 * /crm/analytics/loss — Phase 14, Wave 3.
 *
 * Revenue-loss dashboard with four sources (empty slots, no-shows, late
 * cancellations, dormant patients), a stacked-area daily trend, and a
 * doctor-level drill-down. ADMIN-only; the API enforces it.
 *
 * Reachable from /crm/analytics (the parent page links to this page in its
 * subnav). Not added to the global CRM sidebar.
 */
export default function LossAnalyticsPage() {
  return <LossPageClient />;
}
