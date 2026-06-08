/**
 * POST /api/crm/billing/invoices/[id]/simulate-pay — dev-only stub.
 *
 * Hidden behind THREE conditions, all required:
 *   1. `NODE_ENV !== "production"` — hardcoded prod kill-switch, so a
 *      misconfigured prod env can never accidentally re-enable this route.
 *   2. `NEXT_PUBLIC_BILLING_STUB === "1"` — explicit per-env opt-in for
 *      QA / staging surfaces (also drives the UI button visibility).
 *   3. Admin role — same boundary the rest of the billing surface uses.
 *
 * Returns 404 (not 403) on any miss so the route looks nonexistent in
 * prod. `markInvoicePaid` is called with a synthetic paymentRef so QA
 * can exercise the upgrade flow without provisioning Click/Payme creds.
 */
import { auth } from "@/lib/auth";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";
import { markInvoicePaid } from "@/server/billing/invoice";

export const runtime = "nodejs";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../invoices/[id]/simulate-pay
  return parts[parts.length - 2] ?? "";
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return notFound();
  }
  if (process.env.NEXT_PUBLIC_BILLING_STUB !== "1") {
    // Not a 403 — we want this to look like the route doesn't exist.
    return notFound();
  }
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const id = idFromUrl(request);
  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  return runWithTenant(ctx, async () => {
    const invoice = await prisma.invoice.findFirst({
      where: { id, clinicId: ctx.clinicId as string },
      select: { id: true, status: true },
    });
    if (!invoice) return notFound();

    const ref = `stub-${Math.random().toString(36).slice(2, 10)}`;
    await markInvoicePaid(invoice.id, ref);
    return ok({ ok: true, paymentRef: ref });
  });
}
