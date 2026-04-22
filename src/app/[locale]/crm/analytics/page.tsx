import { AnalyticsPageClient } from "./_components/analytics-page-client";

/**
 * /crm/analytics — aggregated metrics dashboard.
 *
 * Calls `GET /api/crm/analytics?period=...` in one round-trip and renders
 * seven chart sections (TZ §6 analytics).
 *
 * RBAC: ADMIN sees everything; DOCTOR sees only their own slice (the API
 * enforces that by filtering to `doctor.userId === session.user.id`).
 */
export default function AnalyticsPage() {
  return <AnalyticsPageClient />;
}
