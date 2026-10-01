import { LossPageClient } from "./_components/loss-page-client";

/**
 * /crm/analytics/loss — Phase 14, Wave 3.
 *
 * Revenue-loss dashboard with three sources of the period (empty slots,
 * no-shows, late cancellations), a stacked-area daily trend, a doctor-level
 * drill-down, and the dormant patients beside them as a stock that never
 * adds into the period (audit AN-17). ADMIN-only; the API enforces it.
 *
 * Reachable from /crm/analytics (the parent page links to this page in its
 * subnav). Not added to the global CRM sidebar.
 */
export default function LossAnalyticsPage() {
  return <LossPageClient />;
}
