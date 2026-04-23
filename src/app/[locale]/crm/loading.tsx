import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Fallback route-level skeleton for any CRM segment that doesn't define its
 * own `loading.tsx`. Generic shape: header + filter bar + list.
 */
export default function CrmLoading() {
  return <PageSkeleton filters body="table" rows={8} />;
}
