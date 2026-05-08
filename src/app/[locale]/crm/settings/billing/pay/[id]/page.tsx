/**
 * /[locale]/crm/settings/billing/pay/[id] — stub pay page.
 *
 * Server component fetches the invoice and hands it to the client. The
 * "Simulate payment" button is hidden in prod via
 * `NEXT_PUBLIC_BILLING_STUB`.
 */
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";

import { PayStubClient } from "./_components/pay-stub-client";

export const dynamic = "force-dynamic";

export default async function BillingPayPage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await props.params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    redirect(`/${locale}/crm`);
  }
  if (!session.user.clinicId) redirect(`/${locale}/crm`);

  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role,
  };

  const invoice = await runWithTenant(ctx, () =>
    prisma.invoice.findFirst({
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
      },
    }),
  );

  if (!invoice) notFound();

  return (
    <PayStubClient
      locale={locale}
      stubMode={process.env.NEXT_PUBLIC_BILLING_STUB === "1"}
      invoice={{
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        amountTiins: invoice.amountTiins.toString(),
        currency: invoice.currency,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        dueAt: invoice.dueAt.toISOString(),
      }}
    />
  );
}
