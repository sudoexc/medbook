import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";

import { AnalyticsPageClient } from "./_components/analytics-page-client";
import { AnalyticsHubCards } from "./_components/analytics-hub-cards";

/**
 * /crm/analytics — aggregated metrics dashboard.
 *
 * Calls `GET /api/crm/analytics?period=...` in one round-trip and renders
 * seven chart sections (TZ §6 analytics).
 *
 * Phase 18 W2 — surfaces a hub of links to the four pro dashboards
 * (cohorts, doctor performance, financial, schedule heatmap) above the
 * legacy client. The hub only renders for ADMIN/SUPER_ADMIN — others see
 * the legacy view exactly as before.
 *
 * RBAC: ADMIN/SUPER_ADMIN see everything; DOCTOR sees only their own slice
 * (the API enforces that by filtering to `doctor.userId === session.user.id`).
 * Every other role gets a 404 like the pro dashboards (audit AN-33): the API
 * refuses them, so the page could only ever show its load error.
 */
export default async function AnalyticsPage() {
  const session = await auth();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  if (!isAdmin && role !== "DOCTOR") notFound();
  return (
    <>
      {isAdmin ? <AnalyticsHubCards /> : null}
      <AnalyticsPageClient />
    </>
  );
}
