import { PageSkeleton } from "@/components/molecules/page-skeleton";

/** Route-level skeleton for `/crm/tasks`: header + three columns of cards. */
export default function TasksLoading() {
  return <PageSkeleton body="grid" rows={6} />;
}
