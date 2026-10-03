import { Suspense } from "react";

import { DevTaskBoard } from "@/components/dev-tasks/dev-task-board";

/**
 * /doctor/tasks — the «Задачи» board inside the doctor cabinet, so a doctor
 * reports what gets in his way without leaving it. The same board as
 * /crm/tasks: doctors file and comment; only ADMIN / SUPER_ADMIN move tasks
 * between columns. The cabinet layout already admits doctors only.
 */
export default function DoctorTasksPage() {
  return (
    <Suspense>
      <DevTaskBoard />
    </Suspense>
  );
}
