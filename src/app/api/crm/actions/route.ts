/**
 * /api/crm/actions — list. (Phase 13 Wave 1)
 *
 * Tenant-scoped: handled automatically by the Prisma extension since
 * `Action` carries `clinicId` and is NOT in MODELS_WITHOUT_TENANT.
 *
 * No POST here: actions are created exclusively by the Wave-2 engine
 * (`upsertAction`). User-driven mutations live under `/[id]/...`.
 *
 * Filters:
 *   - status: defaults to OPEN-only when omitted; accepts repeated values.
 *   - type: optional, accepts repeated values.
 *   - severity: optional, accepts repeated values.
 *   - assigneeRole: ADMIN | RECEPTIONIST (null assigneeRole is always
 *     visible regardless of this filter — those are "any role" actions).
 *   - cursor: `id` of the last row of the previous page (`nextCursor`).
 *   - limit: 1..100, default 50.
 *
 * Visibility rules (always applied):
 *   - Hide rows where status='EXPIRED' OR (expiresAt is set and ≤ now).
 *   - Hide rows where snoozeUntil > now (the user explicitly silenced them).
 *
 * Sort: severity DESC (critical → low), then surfacedAt DESC, then id DESC,
 * applied BEFORE the limit, so `limit=5` is the five most urgent rows and a
 * task that just came back from a snooze or a scheduled surface time sits at
 * the top of its severity (see `listActionsPage` for why not createdAt).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";
import { QueryActionSchema } from "@/server/schemas/action";
import { listActionsPage } from "@/server/actions/list";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") {
      // SUPER_ADMIN must impersonate; the wrapper already short-circuits
      // mutating handlers for that case but list reads still flow here.
      return err("ClinicNotSelected", 400);
    }

    const parsed = parseQuery(request, QueryActionSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const now = new Date();

    const where: Record<string, unknown> = {};

    // Status filter — default to OPEN when caller omits it. We keep
    // SNOOZED rows visible only when their snoozeUntil has elapsed (handled
    // by the snoozeUntil clause below).
    const statuses = q.status ?? ["OPEN", "SNOOZED"];
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };

    if (q.type && q.type.length > 0) {
      where.type = q.type.length === 1 ? q.type[0] : { in: q.type };
    }
    // Severity is applied by `listActionsPage`, which reads one severity
    // bucket at a time in rank order.
    if (q.assigneeRole) {
      // Show rows assigned to this role OR rows assigned to "any role"
      // (assigneeRole IS NULL).
      where.OR = [
        { assigneeRole: q.assigneeRole },
        { assigneeRole: null },
      ];
    }

    // Hide expired rows: either marked status=EXPIRED (already excluded by
    // the status filter unless the caller explicitly asked for it) OR
    // expiresAt elapsed.
    where.AND = [
      {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      // Hide actively snoozed rows; allow status=SNOOZED whose timer has
      // already elapsed (those resurface as "snoozed-expired" which we
      // surface as still actionable).
      {
        OR: [
          { snoozeUntil: null },
          { snoozeUntil: { lte: now } },
        ],
      },
    ];

    const page = await listActionsPage(prisma, where, {
      limit: q.limit,
      cursor: q.cursor ?? null,
      severities: q.severity ?? null,
    });
    return ok(page);
  },
);

export const POST = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
