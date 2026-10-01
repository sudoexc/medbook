/**
 * POST /api/admin/clinics/[id]/lifecycle — the /admin/clinics row menu.
 *
 * Body: `{ action: "suspend" | "restore" | "extend-trial",
 *          expectedTrialEndsAt?: ISO | null }`.
 *
 * Each action is the same function the billing page uses (audit G5-01,
 * `subscription-admin.ts`):
 * - suspend      → CANCELLED, audits CLINIC_SUSPENDED with what it was;
 * - restore      → only for a CANCELLED subscription (409 `not_cancelled`
 *                  otherwise), back to what it was before the suspension,
 *                  audits CLINIC_RESUMED. It used to make ANY clinic, a
 *                  paying one included, a 14-day trial;
 * - extend-trial → `planExtendTrial`, audits CLINIC_TRIAL_EXTENDED; with
 *                  `expectedTrialEndsAt` a double click is a 409, not a
 *                  second month.
 * A clinic without a subscription gets 409 `NoSubscription` (G5-03).
 */
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { requireSuperAdmin } from "@/server/platform/handler";
import {
  cancelResponse,
  extendTrialResponse,
  restoreResponse,
} from "@/server/platform/subscription-admin";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/lifecycle
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  const id = clinicIdFromUrl(request);
  if (!id) return err("BadRequest", 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    action?: unknown;
    expectedTrialEndsAt?: unknown;
  };
  const action = body.action;
  if (
    action !== "suspend" &&
    action !== "restore" &&
    action !== "extend-trial"
  ) {
    return err("ValidationError", 400, {
      reason: "action must be one of suspend|restore|extend-trial",
    });
  }
  let expectedTrialEndsAt: Date | null | undefined;
  if (body.expectedTrialEndsAt === null) expectedTrialEndsAt = null;
  else if (typeof body.expectedTrialEndsAt === "string") {
    const d = new Date(body.expectedTrialEndsAt);
    if (Number.isNaN(d.getTime())) return err("ValidationError", 400);
    expectedTrialEndsAt = d;
  }

  const args = { request, userId: gate.userId, clinicId: id };
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, () => {
    if (action === "suspend") return cancelResponse(args);
    if (action === "restore") return restoreResponse(args);
    return extendTrialResponse({ ...args, expectedTrialEndsAt });
  });
}
