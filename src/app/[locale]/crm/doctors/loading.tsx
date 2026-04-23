import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Route-level skeleton for `/crm/doctors`. Grid of doctor cards + right rail
 * with KPI + top-3 widgets.
 */
export default function DoctorsLoading() {
  return <PageSkeleton filters body="grid" rows={8} rail />;
}
