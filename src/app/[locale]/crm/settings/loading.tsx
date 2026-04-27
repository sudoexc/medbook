import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for `/crm/settings/*`. Renders inside the layout's
 * children slot while a settings section page suspends on data — keeps the
 * sidebar visible and avoids the blank flash during cross-section navigation.
 */
export default function SettingsLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}
