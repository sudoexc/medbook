import { z } from "zod";

import {
  DEV_TASK_COMMENT_MAX,
  DEV_TASK_DESCRIPTION_MAX,
  DEV_TASK_PRIORITIES,
  DEV_TASK_STATUSES,
  DEV_TASK_TITLE_MAX,
} from "@/lib/dev-tasks";

/**
 * Schemas for the «Задачи» board (`/api/crm/dev-tasks`). Limits come from
 * `src/lib/dev-tasks.ts`, the same numbers the dialog enforces as you type.
 */
export const DevTaskStatusEnum = z.enum(DEV_TASK_STATUSES);
export const DevTaskPriorityEnum = z.enum(DEV_TASK_PRIORITIES);

export const CreateDevTaskSchema = z.object({
  title: z.string().trim().min(1).max(DEV_TASK_TITLE_MAX),
  description: z.string().trim().max(DEV_TASK_DESCRIPTION_MAX).default(""),
  priority: DevTaskPriorityEnum.default("NORMAL"),
});

/**
 * One PATCH for both kinds of change; the route decides who may send which
 * part (text by the author or a manager, status by a manager only).
 */
export const UpdateDevTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(DEV_TASK_TITLE_MAX).optional(),
    description: z.string().trim().max(DEV_TASK_DESCRIPTION_MAX).optional(),
    priority: DevTaskPriorityEnum.optional(),
    status: DevTaskStatusEnum.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.priority !== undefined ||
      v.status !== undefined,
    { message: "empty_patch" },
  );

export const CreateDevTaskCommentSchema = z.object({
  text: z.string().trim().min(1).max(DEV_TASK_COMMENT_MAX),
});

/**
 * `status` may repeat (`?status=NEW&status=DONE`). No status = the board:
 * every open task plus the recently finished, cancelled only on request.
 */
export const QueryDevTasksSchema = z.object({
  status: z
    .union([DevTaskStatusEnum, z.array(DevTaskStatusEnum)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  includeCancelled: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export type CreateDevTask = z.infer<typeof CreateDevTaskSchema>;
export type UpdateDevTask = z.infer<typeof UpdateDevTaskSchema>;
export type CreateDevTaskComment = z.infer<typeof CreateDevTaskCommentSchema>;
