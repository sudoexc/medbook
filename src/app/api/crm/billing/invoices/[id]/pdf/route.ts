/**
 * GET /api/crm/billing/invoices/[id]/pdf — admin-only PDF stream.
 *
 * Headers mirror the analytics PDF route. The caller must own the
 * invoice (clinic-scope is enforced by the tenant Prisma extension and
 * a defensive `clinicId` check).
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { err, notFound } from "@/server/http";
import { formatInvoicePdf, invoicePdfFilename } from "@/server/billing/pdf";

export const runtime = "nodejs";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../invoices/[id]/pdf  →  parts = [..., "invoices", id, "pdf"]
  return parts[parts.length - 2] ?? "";
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return err("Forbidden", 403);
  }
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
      select: {
        id: true,
        number: true,
        status: true,
        amountTiins: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        dueAt: true,
        paidAt: true,
        paymentRef: true,
        targetPlanId: true,
      },
    });
    if (!invoice) return notFound();

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId as string },
      select: { nameRu: true, nameUz: true },
    });
    const sub = await prisma.subscription.findUnique({
      where: { clinicId: ctx.clinicId as string },
      include: { plan: true },
    });
    if (!sub) return err("NoSubscription", 409);

    // The plan this invoice was issued for (audit AN-29): the one captured on
    // the invoice at creation, which is also what paying it grants
    // (markInvoicePaid). The subscription's pendingPlanId is only the latest
    // queued upgrade, so an older invoice's PDF used to name whatever was
    // requested after it. No target (an invoice from before the column):
    // paying it leaves the plan as it is, so the current one.
    const targetPlan = invoice.targetPlanId
      ? await prisma.plan.findUnique({
          where: { id: invoice.targetPlanId },
          select: { slug: true, nameRu: true, nameUz: true },
        })
      : null;
    const plan = targetPlan ?? {
      slug: sub.plan.slug,
      nameRu: sub.plan.nameRu,
      nameUz: sub.plan.nameUz,
    };

    const pdf = await formatInvoicePdf({
      invoice: { ...invoice, currency: invoice.currency as unknown as string },
      clinic: {
        nameRu: clinic?.nameRu ?? "Clinic",
        nameUz: clinic?.nameUz ?? "Klinika",
      },
      plan,
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${invoicePdfFilename(invoice.number)}"`,
        "cache-control": "no-store",
      },
    });
  });
}
