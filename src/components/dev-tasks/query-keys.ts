/**
 * React Query keys of the «Задачи» board. Kept apart from the hooks so the
 * CRM sidebar badge can share them without pulling the upload code into
 * every CRM page.
 */
export const devTasksKey = ["crm", "dev-tasks"] as const;
export const devTasksBoardKey = (includeCancelled: boolean) =>
  [...devTasksKey, "board", includeCancelled] as const;
export const devTaskKey = (ref: string) => [...devTasksKey, "task", ref] as const;
export const devTasksOpenCountKey = [...devTasksKey, "open-count"] as const;
