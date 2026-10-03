/**
 * POST /api/crm/dev-tasks/[id]/comments — `{ text }`: a reply in the task's
 * thread. Everyone who sees the board may comment (the owner answering the
 * developer's question, a doctor adding «у меня тоже»). Returns the whole
 * task so the drawer redraws from one response.
 *
 * The task's `updatedAt` moves with each comment: the board reads it as
 * «last activity».
 */
import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { DEV_TASK_ROLES, parseDevTaskRef } from "@/lib/dev-tasks";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { devTaskRefWhere, loadDevTaskDetail } from "@/server/dev-tasks/board";
import { err, notFound, ok } from "@/server/http";
import {
  CreateDevTaskCommentSchema,
  type CreateDevTaskComment,
} from "@/server/schemas/dev-task";

/** A lively back-and-forth fits; a runaway client does not. */
const COMMENTS_PER_HOUR = 120;

function refFromUrl(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../dev-tasks/[id]/comments
  return parseDevTaskRef(decodeURIComponent(parts[parts.length - 2] ?? ""));
}

export const POST = createApiHandler<CreateDevTaskComment>(
  { roles: [...DEV_TASK_ROLES], bodySchema: CreateDevTaskCommentSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const ref = refFromUrl(request);
    if (!ref) return notFound();
    if (
      !rateLimit(`dev-task-comment:${ctx.userId}`, COMMENTS_PER_HOUR, 3_600_000, "dev-tasks")
    ) {
      return err("TooManyRequests", 429, { reason: "dev_task_rate_limited" });
    }

    const task = await prisma.devTask.findFirst({
      where: devTaskRefWhere(ref),
      select: { id: true, number: true },
    });
    if (!task) return notFound();

    const comment = await prisma.$transaction(async (tx) => {
      const row = await tx.devTaskComment.create({
        data: {
          clinicId: ctx.clinicId,
          taskId: task.id,
          authorId: ctx.userId,
          text: body.text,
        },
        select: { id: true },
      });
      await tx.devTask.update({
        where: { id: task.id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      return row;
    });

    await audit(request, {
      action: AUDIT_ACTION.DEV_TASK_COMMENTED,
      entityType: "DevTask",
      entityId: task.id,
      meta: { number: task.number, commentId: comment.id },
    });

    const detail = await loadDevTaskDetail(
      { id: task.id },
      { userId: ctx.userId, role: ctx.role },
    );
    return detail ? ok(detail, 201) : notFound();
  },
);
