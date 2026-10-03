/**
 * /api/crm/dev-tasks — the «Задачи» board: requests from the clinic to the
 * CRM developers (`src/lib/dev-tasks.ts` has the rules).
 *
 * GET  — the board: every open task, the latest finished ones, cancelled on
 *        request (`?includeCancelled=1`), or exactly `?status=…`; `counts`
 *        are the real per-column totals.
 * POST — file a task `{ title, description, priority }`. Screenshots follow
 *        one by one through `[id]/attachments` (one 10 MB file per request
 *        keeps every upload under nginx's 25 MB body limit).
 *
 * Everyone who sees the board may file a task: the owner, admins, the desk
 * and doctors (from their cabinet). SUPER_ADMIN, inside a clinic, too.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { DEV_TASK_ROLES } from "@/lib/dev-tasks";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  allocateDevTaskNumber,
  loadDevTaskBoard,
  loadDevTaskDetail,
} from "@/server/dev-tasks/board";
import { err, ok, parseQuery } from "@/server/http";
import {
  CreateDevTaskSchema,
  QueryDevTasksSchema,
  type CreateDevTask,
} from "@/server/schemas/dev-task";

/**
 * Tasks one person may file per hour. Generous for a real backlog session
 * (the owner walking through the CRM and filing what he sees), tight enough
 * that a stuck retry loop or a script cannot bury the board.
 */
const DEV_TASK_CREATES_PER_HOUR = 30;

export const GET = createApiListHandler(
  { roles: [...DEV_TASK_ROLES] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryDevTasksSchema);
    if (!parsed.ok) return parsed.response;
    const board = await loadDevTaskBoard({
      statuses: parsed.value.status,
      includeCancelled: parsed.value.includeCancelled,
    });
    return ok(board);
  },
);

export const POST = createApiHandler<CreateDevTask>(
  { roles: [...DEV_TASK_ROLES], bodySchema: CreateDevTaskSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    if (
      !rateLimit(
        `dev-task-create:${ctx.userId}`,
        DEV_TASK_CREATES_PER_HOUR,
        3_600_000,
        "dev-tasks",
      )
    ) {
      return err("TooManyRequests", 429, { reason: "dev_task_rate_limited" });
    }

    // Number and row in one transaction: a failed insert gives the number
    // back instead of leaving a gap in the «#N» sequence.
    const created = await prisma.$transaction(async (tx) => {
      const number = await allocateDevTaskNumber(ctx.clinicId, tx);
      return tx.devTask.create({
        data: {
          clinicId: ctx.clinicId,
          number,
          title: body.title,
          description: body.description,
          priority: body.priority,
          createdById: ctx.userId,
        },
        select: { id: true, number: true, priority: true },
      });
    });

    await audit(request, {
      action: AUDIT_ACTION.DEV_TASK_CREATED,
      entityType: "DevTask",
      entityId: created.id,
      meta: { number: created.number, priority: created.priority },
    });

    const detail = await loadDevTaskDetail(
      { id: created.id },
      { userId: ctx.userId, role: ctx.role },
    );
    return ok(detail, 201);
  },
);
