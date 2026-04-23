import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for `/crm/calendar`. Toolbar + calendar grid stub.
 */
export default function CalendarLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      <div className="flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[96px_repeat(6,minmax(0,1fr))] border-b border-border">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="border-r border-border p-3 last:border-r-0">
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
