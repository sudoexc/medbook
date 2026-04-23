import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Route-level skeleton for `/crm/appointments`. KPI strip + filters + table.
 */
export default function AppointmentsLoading() {
  return <PageSkeleton kpi filters body="table" rows={12} />;
}
