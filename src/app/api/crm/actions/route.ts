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
 *   - cursor: createdAt ISO of last seen row. Pagination secondary key is
 *     `id` to break ties deterministically.
 *   - limit: 1..100, default 50.
 *
 * Visibility rules (always applied):
 *   - Hide rows where status='EXPIRED' OR (expiresAt is set and ≤ now).
 *   - Hide rows where snoozeUntil > now (the user explicitly silenced them).
 *
 * Sort: severity DESC (critical → low), then createdAt DESC, then id DESC
 * for stable ordering. Severity ranks come from `SEVERITY_RANK` in
 * `src/lib/actions/types.ts`; we translate to a numeric sort key in JS
 * after fetching to keep the SQL simple (severity is a free-form string
 * column — adding a CASE WHEN per query would clutter the index plan).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";
import { QueryActionSchema } from "@/server/schemas/action";
import {
  SEVERITY_RANK,
  type ActionSeverity,
} from "@/lib/actions/types";

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
    if (q.severity && q.severity.length > 0) {
      where.severity =
        q.severity.length === 1 ? q.severity[0] : { in: q.severity };
    }
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

    // Cursor pagination: createdAt ISO. We over-fetch by one to compute
    // the next cursor, then trim. For deterministic ordering when many rows
    // share a createdAt timestamp we add `id` as the tiebreaker.
    const take = q.limit + 1;
    const rows = await prisma.action.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    // Severity sort happens in JS — see file header rationale.
    rows.sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity as ActionSeverity] ?? 0;
      const sb = SEVERITY_RANK[b.severity as ActionSeverity] ?? 0;
      if (sa !== sb) return sb - sa;
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (ta !== tb) return tb - ta;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    return ok({ rows, nextCursor });
  },
);

export const POST = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
