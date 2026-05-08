import { ForecastPageClient } from "./_components/forecast-page-client";

/**
 * /crm/analytics/forecast — Phase 14, Wave 3.
 *
 * 30-day forward revenue forecast with confidence bands and what-if
 * sliders. The chart re-renders entirely client-side when sliders move —
 * server only ships the baseline `ForecastPoint[]` once.
 *
 * ADMIN-only; the API enforces it.
 */
export default function ForecastPage() {
  return <ForecastPageClient />;
}
