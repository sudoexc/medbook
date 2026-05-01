/**
 * GET /api/crm/ai/eta?appointmentId=…
 *
 * Phase 10 — predicted duration for a single appointment. Uses up to 30 of
 * the most-recent COMPLETED visits for the same (doctor, service) pair to
 * compute a median; falls back to `service.durationMin` for cold-start.
 *
 * Roles: ADMIN, RECEPTIONIST, NURSE, DOCTOR.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok, err } from "@/server/http";
import { resolveEta } from "@/server/ai/resolve-eta";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const appointmentId = url.searchParams.get("appointmentId");
    if (!appointmentId) {
      return err("ValidationError", 400, { reason: "appointmentId_required" });
    }
    const result = await resolveEta(appointmentId);
    if (!result) return err("NotFound", 404);
    return ok(result);
  },
);
