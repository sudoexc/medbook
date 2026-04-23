import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Route-level skeleton for `/crm/reception`. KPI strip + doctor queue grid
 * + right rail (calls / TG / cabinets / reminders).
 */
export default function ReceptionLoading() {
  return <PageSkeleton kpi body="grid" rows={8} rail />;
}
