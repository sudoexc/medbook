import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for `/crm/call-center`. The page is a 3-column layout
 * (incoming queue / active call / history), so a table-shaped generic
 * skeleton doesn't fit — we hand-roll three placeholder panes to match.
 */
export default function CallCenterLoading() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4">
      <aside className="hidden w-[320px] shrink-0 flex-col gap-3 lg:flex">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <Skeleton className="h-14 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </section>

      <aside className="hidden w-[380px] shrink-0 flex-col gap-3 xl:flex">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </aside>
    </div>
  );
}
