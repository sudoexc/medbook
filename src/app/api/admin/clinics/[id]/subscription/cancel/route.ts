/**
 * POST /api/admin/clinics/[id]/subscription/cancel
 *
 * Soft-cancellation: sets `status=CANCELLED` and `cancelledAt=NOW()`. Does not
 * delete the row — the audit trail and the option to revert both depend on
 * the row staying around.
 *
 * Same action as the clinics row menu's «Приостановить» (audit G5-01): one
 * function, one audit action (CLINIC_SUSPENDED) with the snapshot that
 * «Восстановить» brings back. Already cancelled answers 200 unchanged. A
 * clinic without a subscription gets 409 `NoSubscription` (G5-03): nothing
 * is created just to be cancelled.
 */
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { requireSuperAdmin } from "@/server/platform/handler";
import { cancelResponse } from "@/server/platform/subscription-admin";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/subscription/cancel
    //  0   1     2       3    4            5
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
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, () =>
    cancelResponse({ request, userId: gate.userId, clinicId: id }),
  );
}
