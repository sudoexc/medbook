/**
 * /api/crm/dev-tasks/[id] — one task of the «Задачи» board. `[id]` is the
 * row id or the clinic's number («12»), so a link quoted in a chat as «#12»
 * opens the same task.
 *
 * GET   — the task with its screenshots, comments and what this viewer may do.
 * PATCH — `{ title?, description?, priority?, status? }`:
 *           - text and priority: the author, or ADMIN / SUPER_ADMIN;
 *           - status: ADMIN / SUPER_ADMIN only, along the transitions in
 *             `src/lib/dev-tasks.ts` (409 otherwise). The same status again
 *             is a no-op, so a double tap on a phone does not error.
 *         A status move is conditional on the column it was read in, so two
 *         people pressing different buttons at once cannot both win.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  DEV_TASK_ROLES,
  canEditDevTask,
  canManageDevTasks,
  parseDevTaskRef,
  planStatusChange,
  type DevTaskPriority,
  type DevTaskStatus,
} from "@/lib/dev-tasks";
import { prisma } from "@/lib/prisma";
import { devTaskRefWhere, loadDevTaskDetail } from "@/server/dev-tasks/board";
import { conflict, err, notFound, ok } from "@/server/http";
import { UpdateDevTaskSchema, type UpdateDevTask } from "@/server/schemas/dev-task";

function refFromUrl(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../dev-tasks/[id]
  return parseDevTaskRef(decodeURIComponent(parts[parts.length - 1] ?? ""));
}

export const GET = createApiListHandler(
  { roles: [...DEV_TASK_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const ref = refFromUrl(request);
    if (!ref) return notFound();
    const detail = await loadDevTaskDetail(ref, { userId: ctx.userId, role: ctx.role });
    return detail ? ok(detail) : notFound();
  },
);

export const PATCH = createApiHandler<UpdateDevTask>(
  { roles: [...DEV_TASK_ROLES], bodySchema: UpdateDevTaskSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const ref = refFromUrl(request);
    if (!ref) return notFound();
    const viewer = { userId: ctx.userId, role: ctx.role };

    const before = await prisma.devTask.findFirst({
      where: devTaskRefWhere(ref),
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        startedAt: true,
        doneAt: true,
        createdById: true,
      },
    });
    if (!before) return notFound();

    const touchesText =
      body.title !== undefined ||
      body.description !== undefined ||
      body.priority !== undefined;
    if (touchesText && !canEditDevTask(viewer, before)) {
      return err("Forbidden", 403, { reason: "dev_task_author_only" });
    }
    if (body.status !== undefined && !canManageDevTasks(ctx.role)) {
      return err("Forbidden", 403, { reason: "dev_task_status_admin_only" });
    }

    const data: {
      title?: string;
      description?: string;
      priority?: DevTaskPriority;
      status?: DevTaskStatus;
      startedAt?: Date | null;
      doneAt?: Date | null;
    } = {};
    const changedFields: string[] = [];
    if (body.title !== undefined && body.title !== before.title) {
      data.title = body.title;
      changedFields.push("title");
    }
    if (body.description !== undefined && body.description !== before.description) {
      data.description = body.description;
      changedFields.push("description");
    }
    if (body.priority !== undefined && body.priority !== before.priority) {
      data.priority = body.priority;
      changedFields.push("priority");
    }

    let moved: { from: DevTaskStatus; to: DevTaskStatus } | null = null;
    if (body.status !== undefined && body.status !== before.status) {
      const plan = planStatusChange(before, body.status, new Date());
      if (!plan.ok) {
        return conflict(plan.reason, { from: before.status, to: body.status });
      }
      Object.assign(data, plan.data);
      moved = { from: before.status, to: body.status };
    }

    if (Object.keys(data).length > 0) {
      const res = await prisma.devTask.updateMany({
        where: { id: before.id, ...(moved ? { status: before.status } : {}) },
        data,
      });
      if (res.count === 0) {
        return conflict("dev_task_status_changed", { from: before.status });
      }
    }

    if (moved) {
      await audit(request, {
        action: AUDIT_ACTION.DEV_TASK_STATUS_CHANGED,
        entityType: "DevTask",
        entityId: before.id,
        meta: { number: before.number, from: moved.from, to: moved.to },
      });
    }
    if (changedFields.length > 0) {
      await audit(request, {
        action: AUDIT_ACTION.DEV_TASK_UPDATED,
        entityType: "DevTask",
        entityId: before.id,
        meta: {
          number: before.number,
          fields: changedFields,
          ...(data.priority ? { priority: data.priority } : {}),
        },
      });
    }

    const detail = await loadDevTaskDetail({ id: before.id }, viewer);
    return detail ? ok(detail) : notFound();
  },
);
