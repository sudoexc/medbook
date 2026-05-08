/**
 * POST /api/crm/actions/recompute — Phase 13 Wave 2.
 *
 * Manual trigger for the Action Center engine. ADMIN only — this is a
 * potentially expensive sweep (10 detectors × clinic data) and should not be
 * exposed to RECEPTIONIST traffic. Useful for QA, the Wave-3 "Refresh now"
 * button, and prod debugging.
 *
 * The engine itself is tenant-context-agnostic — we're already inside the
 * `runWithTenant` boundary established by `createApiHandler`, so the Prisma
 * extension scopes detector queries to the caller's clinic.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { runActionEngine } from "@/server/actions/engine";

export const POST = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const result = await runActionEngine(prisma, ctx.clinicId, new Date());
    return ok(result);
  },
);

export const GET = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
