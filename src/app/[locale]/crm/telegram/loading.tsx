import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for `/crm/telegram`. 3-column inbox layout:
 * conversations list / chat pane / patient rail.
 */
export default function TelegramLoading() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4">
      <aside className="hidden w-[320px] shrink-0 flex-col gap-3 lg:flex">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className={
                i % 2 === 0
                  ? "ml-auto h-10 w-64 rounded-lg"
                  : "mr-auto h-10 w-80 rounded-lg"
              }
            />
          ))}
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
      </section>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-3 xl:flex">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </aside>
    </div>
  );
}
