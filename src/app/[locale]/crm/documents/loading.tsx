import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Route-level skeleton for `/crm/documents`. Header + filters + table.
 */
export default function DocumentsLoading() {
  return <PageSkeleton filters body="table" rows={10} />;
}
