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

    const planForPdf = sub.pendingPlanId
      ? await prisma.plan.findUnique({
          where: { id: sub.pendingPlanId },
          select: { slug: true, nameRu: true, nameUz: true },
        })
      : null;
    const plan = planForPdf ?? {
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
