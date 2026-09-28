/**
 * GET /api/crm/actions/summary — aggregate of every visible open task, for
 * the Action Center KPI tiles and counters (audit AC-18).
 *
 * Same visibility as `GET /api/crm/actions` with no filters (OPEN + elapsed
 * SNOOZED, not expired), computed over all rows rather than the page the
 * client happens to hold. See `src/server/actions/summary.ts`.
 *
 * RBAC: the list's roles.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { visibleActionsWhere } from "@/server/actions/list";
import { summarizeActions } from "@/server/actions/summary";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const summary = await summarizeActions(prisma, visibleActionsWhere(new Date()));
    return ok(summary);
  },
);

export const POST = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
