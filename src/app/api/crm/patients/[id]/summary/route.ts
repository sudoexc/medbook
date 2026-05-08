/**
 * /api/crm/patients/[id]/summary — Phase 15 Wave 2.
 *
 * GET ?locale=ru|uz — returns the cached LLM patient summary or enqueues a
 * refresh job and returns the stale text immediately. The UI subscribes to
 * `patient.summary.refreshed` and refetches when the worker publishes.
 *
 * Response: `{ text, cacheAge, pendingRefresh, updatedAt }`
 *
 * Auth: any role with patient read access (matches the patient-card scope).
 * Refresh enqueue ignores tenant scope by design — the worker re-derives
 * context with explicit `clinicId`.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { readOrRefreshPatientSummary } from "@/server/ai/patient-summary-cache";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/summary
  return parts[parts.length - 2] ?? "";
}

function readLocale(request: Request): "ru" | "uz" {
  const raw = new URL(request.url).searchParams.get("locale");
  return raw === "uz" ? "uz" : "ru";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
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
    );
    return ok(result);
  },
);
