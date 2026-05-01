/**
 * GET /api/crm/ai/queue
 *
 * Phase 10 — receptionist queue ranking. Returns today's BOOKED / WAITING /
 * IN_PROGRESS appointments (auto-scoped by tenant + active branch) sorted by
 * the AI engine's queue score.
 *
 * Roles: ADMIN, RECEPTIONIST, NURSE, DOCTOR.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { resolveQueueScores } from "@/server/ai/resolve-queue-scores";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"] },
  async () => {
    const items = await resolveQueueScores();
    return ok({ items });
  },
);
