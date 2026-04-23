import { PageSkeleton } from "@/components/molecules/page-skeleton";

/**
 * Next.js route-level skeleton for `/crm/patients`. Rendered during server
 * navigation to the segment (first load, SSR streaming suspense boundary).
 * Mirrors the final layout: header + filter bar + virtualised table + right
 * rail with demographics/source widgets.
 */
export default function PatientsLoading() {
  return <PageSkeleton filters body="table" rows={10} rail />;
}
