import { PageSkeleton } from "@/components/molecules/page-skeleton";

/** Route-level skeleton for `/crm/online-requests`. Header + tabs + list. */
export default function OnlineRequestsLoading() {
  return <PageSkeleton filters body="table" rows={6} />;
}
