import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for `/crm/notifications`. Tabs row + left template
 * tree + right editor pane + stats rail.
 */
export default function NotificationsLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <Skeleton className="h-9 w-80" />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="hidden w-[280px] shrink-0 flex-col gap-2 lg:flex">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>

        <aside className="hidden w-[280px] shrink-0 flex-col gap-2 xl:flex">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </aside>
      </div>
    </div>
  );
}
