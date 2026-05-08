/**
 * POST /api/crm/billing/invoices/[id]/simulate-pay — dev-only stub.
 *
 * Hidden behind `NEXT_PUBLIC_BILLING_STUB === "1"` AND the admin role.
 * Calls `markInvoicePaid` directly with a synthetic paymentRef so QA
 * can exercise the upgrade flow without provisioning Click/Payme creds.
 *
 * Returning 404 in prod (when the env flag is unset) keeps the
 * surface area small without a separate routing config — the route
 * exists, but a non-stub deployment will reject every call.
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
