/**
 * One page of the Action work list, most urgent first (`GET /api/crm/actions`).
 *
 * Order: severity (critical → low), then `surfacedAt` DESC, then `id` DESC.
 *
 * `surfacedAt`, not `createdAt`: a row that comes back from «Отложить», or a
 * control-visit call scheduled weeks ahead, keeps its old `createdAt`. Ordered
 * by insert time it resurfaced below every newer row and fell past the
 * briefing's five and the Action Center's fifty, so it never reached anyone.
 *
 * Severity before the limit: the page used to be cut to the newest N first and
 * only then sorted by severity, so the reception briefing showed the five
 * newest rows rather than the five most urgent. `severity` is a free-form
 * string column (alphabetical order is not rank order), so instead of a CASE
 * expression the page is read one severity bucket at a time, in rank order,
 * each bucket in SQL order with its own limit. A page touches at most one
 * query per bucket and stops as soon as it is full.
 *
 * Cursor: the `id` of the last row returned. The next page resumes strictly
 * after that row's (severity, surfacedAt, id) position, read back from the row
 * itself, so the cursor survives the row being closed in between.
 */
import type { Action } from "@/generated/prisma/client";
import {
  ACTION_SEVERITIES,
  SEVERITY_RANK,
  type ActionSeverity,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

type PrismaLike = TenantScopedPrisma;

/** Rows with a severity outside the known four sort last, as rank 0. */
const OTHER = "__other__";

function rankOf(severity: string): number {
  return SEVERITY_RANK[severity as ActionSeverity] ?? 0;
}

function bucketWhere(bucket: string): Record<string, unknown> {
  return bucket === OTHER
    ? { severity: { notIn: [...ACTION_SEVERITIES] } }
    : { severity: bucket };
}

export type ActionListPage = { rows: Action[]; nextCursor: string | null };

/**
 * The rows a work list can reach (`GET /api/crm/actions`), before paging.
 * The KPI summary (`summarizeActions`) aggregates over exactly this set, so a
 * tile's count equals what paging through the list would show (audit AC-18).
 *
 *   - status: OPEN + SNOOZED by default; a SNOOZED row counts only once its
 *     timer has run out (a snoozed row "comes back" by the clock);
 *   - hidden: EXPIRED rows, and rows whose `expiresAt` has passed;
 *   - assigneeRole: the role's rows plus "any role" rows (null).
 */
export function visibleActionsWhere(
  now: Date,
  filters: {
    statuses?: readonly string[] | null;
    types?: readonly string[] | null;
    assigneeRole?: "ADMIN" | "RECEPTIONIST" | null;
  } = {},
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  // Status filter — default to OPEN + SNOOZED when the caller omits it. We
  // keep SNOOZED rows visible only when their snoozeUntil has elapsed
  // (handled by the snoozeUntil clause below).
  const statuses =
    filters.statuses && filters.statuses.length > 0
      ? filters.statuses
      : ["OPEN", "SNOOZED"];
  where.status = statuses.length === 1 ? statuses[0] : { in: [...statuses] };

  if (filters.types && filters.types.length > 0) {
    where.type =
      filters.types.length === 1 ? filters.types[0] : { in: [...filters.types] };
  }
  if (filters.assigneeRole) {
    // Show rows assigned to this role OR rows assigned to "any role"
    // (assigneeRole IS NULL).
    where.OR = [{ assigneeRole: filters.assigneeRole }, { assigneeRole: null }];
  }

  where.AND = [
    // Hide expired rows: either marked status=EXPIRED (already excluded by
    // the status filter unless the caller explicitly asked for it) OR
    // expiresAt elapsed.
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    // Hide actively snoozed rows; allow status=SNOOZED whose timer has
    // already elapsed (those resurface as "snoozed-expired" which we
    // surface as still actionable).
    { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] },
  ];
  return where;
}

export async function listActionsPage(
  prisma: PrismaLike,
  where: Record<string, unknown>,
  opts: {
    limit: number;
    cursor?: string | null;
    /** The caller's severity filter (validated against ACTION_SEVERITIES);
     *  every severity when omitted. */
    severities?: readonly string[] | null;
  },
): Promise<ActionListPage> {
  const buckets: string[] = (
    opts.severities && opts.severities.length > 0
      ? [...new Set(opts.severities)]
      : [...ACTION_SEVERITIES, OTHER]
  ).sort((a, b) => rankOf(b) - rankOf(a));

  let after: { rank: number; surfacedAt: Date; id: string } | null = null;
  if (opts.cursor) {
    const c = await prisma.action.findUnique({
      where: { id: opts.cursor },
      select: { id: true, severity: true, surfacedAt: true },
    });
    // A cursor that names no row cannot be placed; an empty page is safer
    // than silently restarting from the top and serving duplicates.
    if (!c) return { rows: [], nextCursor: null };
    after = { rank: rankOf(c.severity), surfacedAt: c.surfacedAt, id: c.id };
  }

  const want = opts.limit + 1; // one extra row tells whether a next page exists
  const rows: Action[] = [];
  for (const bucket of buckets) {
    if (rows.length >= want) break;
    const rank = rankOf(bucket);
    if (after && rank > after.rank) continue; // bucket already paged through
    const keyset =
      after && rank === after.rank
        ? [
            {
              OR: [
                { surfacedAt: { lt: after.surfacedAt } },
                { surfacedAt: after.surfacedAt, id: { lt: after.id } },
              ],
            },
          ]
        : [];
    const part = await prisma.action.findMany({
      where: { AND: [where, bucketWhere(bucket), ...keyset] },
      orderBy: [{ surfacedAt: "desc" }, { id: "desc" }],
      take: want - rows.length,
    });
    rows.push(...part);
  }

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    rows: page,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
