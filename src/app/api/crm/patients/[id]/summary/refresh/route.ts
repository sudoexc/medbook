/**
 * /api/crm/patients/[id]/summary/refresh — Phase 15 Wave 2.
 *
 * POST — force-enqueue a refresh job for the patient's LLM summary. Used by
 * the "Обновить" button on the summary card. Returns immediately; the UI
 * subscribes to `patient.summary.refreshed` and refetches when done.
 *
 * Permissions: ADMIN or DOCTOR only (per the matrix — these are the roles
 * that own the medical context the summary describes). RECEPTIONIST etc.
 * see the auto-generated value but cannot force a regeneration that costs
 * tokens.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, ok } from "@/server/http";
import { readOrRefreshPatientSummary } from "@/server/ai/patient-summary-cache";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/summary/refresh
  return parts[parts.length - 3] ?? "";
}

function readLocale(request: Request): "ru" | "uz" {
  const raw = new URL(request.url).searchParams.get("locale");
  return raw === "uz" ? "uz" : "ru";
}

// Use createApiListHandler — POST without a JSON body. Locale comes from
// the query string so the same route can be hit from either the AI card's
// button (admin/doctor) or programmatically by a future "Sync now" job.
export const POST = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    if (!id) return err("MissingPatientId", 400);
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const locale = readLocale(request);
    const result = await readOrRefreshPatientSummary(
      prisma as never,
      ctx.clinicId,
      ctx.userId,
      id,
      locale,
      { forceRefresh: true },
    );

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_SUMMARY_REFRESHED,
      entityType: "Patient",
      entityId: id,
      meta: { locale },
    });

    return ok(result);
  },
);
