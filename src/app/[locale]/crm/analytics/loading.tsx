import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/molecules/page-container";

/**
 * Route-level skeleton for `/crm/analytics`. Header + period tabs + 2×3
 * chart grid.
 */
export default function AnalyticsLoading() {
  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </PageContainer>
  );
}
