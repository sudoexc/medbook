/**
 * POST /api/admin/clinics/[id]/subscription/extend-trial
 *
 * SUPER_ADMIN «Продлить триал на 30 дней». The rule lives in
 * `planExtendTrial` and is shared with the clinics row menu (audit G5-01):
 * a TRIAL gets 30 more days from its current end, a PAST_DUE or CANCELLED
 * subscription is back in TRIAL until now + 30 days (the banner goes away),
 * an ACTIVE one is refused with 409 `subscription_active`.
 *
 * Body (optional): `{ expectedTrialEndsAt: ISO | null }`, the trial end the
 * page showed. If it no longer matches, the trial was already extended (a
 * double click, another tab) and the answer is 409 `subscription_changed`
 * with the current subscription instead of a second month.
 */
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { requireSuperAdmin } from "@/server/platform/handler";
import { extendTrialResponse } from "@/server/platform/subscription-admin";
import { readExpectedTrialEndsAt } from "@/server/platform/subscription-body";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/subscription/extend-trial
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
  const expected = await readExpectedTrialEndsAt(request);
  if (expected === "invalid") return err("ValidationError", 400);
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, () =>
    extendTrialResponse({
      request,
      userId: gate.userId,
      clinicId: id,
      expectedTrialEndsAt: expected,
    }),
  );
}
