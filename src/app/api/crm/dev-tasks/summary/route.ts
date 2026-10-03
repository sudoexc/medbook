/**
 * GET /api/crm/dev-tasks/summary — `{ open }`, the number of tasks still
 * waiting for the developers (NEW + IN_PROGRESS), for the «Задачи» badge in
 * the CRM sidebar and the doctor cabinet. One count, polled by the chrome,
 * so it is kept apart from the board's heavier list.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { DEV_TASK_ROLES } from "@/lib/dev-tasks";
import { countOpenDevTasks } from "@/server/dev-tasks/board";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: [...DEV_TASK_ROLES] },
  async () => ok({ open: await countOpenDevTasks() }),
);
