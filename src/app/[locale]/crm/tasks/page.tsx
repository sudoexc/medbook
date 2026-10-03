import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { DevTaskBoard } from "@/components/dev-tasks/dev-task-board";
import { PageContainer } from "@/components/molecules/page-container";
import { auth } from "@/lib/auth";
import { canSeeDevTasks } from "@/lib/dev-tasks";

/**
 * /crm/tasks — «Задачи»: the owner's requests to the CRM developers
 * (src/lib/dev-tasks.ts). Thin server shell: the API enforces the roles; a
 * role without the board (nurse, call operator) gets a note instead of a
 * page of 403s. Doctors use the same board in their cabinet (/doctor/tasks).
 */
export default async function TasksPage() {
  const session = await auth();
  if (!canSeeDevTasks(session?.user?.role)) {
    const t = await getTranslations("devTasks");
    return (
      <PageContainer>
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("forbidden")}
        </p>
      </PageContainer>
    );
  }
  // useSearchParams (the open task, `?task=12`) needs a boundary.
  return (
    <Suspense>
      <DevTaskBoard />
    </Suspense>
  );
}
