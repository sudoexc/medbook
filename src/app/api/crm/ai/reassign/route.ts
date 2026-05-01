/**
 * GET /api/crm/ai/reassign
 *
 * Phase 10 — reassignment suggestions. Returns the per-doctor load snapshot
 * plus a list of `{ appointmentId, fromDoctorId, toDoctorId, reason,
 * estDelaySaved }` candidates that the doctors-AI panel renders.
 *
 * Roles: ADMIN, RECEPTIONIST, NURSE, DOCTOR.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { resolveReassign } from "@/server/ai/resolve-reassign";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"] },
  async () => {
    const result = await resolveReassign();
    return ok({ candidates: result.candidates, loads: result.loads });
  },
);
