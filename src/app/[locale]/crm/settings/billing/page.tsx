/**
 * /[locale]/crm/settings/billing — admin-only billing surface.
 *
 * Server component: fetches subscription + usage + invoice list, then
 * hands them to the client renderer. Role gate is supplied by the
 * settings layout (ADMIN / SUPER_ADMIN), but we double-check the
 * subscription exists so a misconfigured tenant gets a clean error
 * instead of a layout crash.
 */
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { getClinicUsage } from "@/server/billing/usage";
import { parsePlanFeatures } from "@/lib/feature-flags";

import {
  BillingClient,
  type BillingPagePlan,
  type BillingPageProps,
} from "./_components/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
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

  // SSR seeds the first page of invoices (limit+1 trick mirrors the
  // API at /api/crm/billing/invoices). The client useInfiniteQuery
  // takes over for subsequent pages and any status-filter changes.
  const INITIAL_INVOICE_LIMIT = 20;

  const data = await runWithTenant(ctx, async () => {
    const [sub, plans, invoiceRowsPlus1, usage] = await Promise.all([
      prisma.subscription.findUnique({
        where: { clinicId: ctx.clinicId as string },
        include: { plan: true },
      }),
      prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.invoice.findMany({
        where: { clinicId: ctx.clinicId as string },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: INITIAL_INVOICE_LIMIT + 1,
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
          createdAt: true,
        },
      }),
      getClinicUsage(ctx.clinicId as string),
    ]);

    let invoiceNextCursor: string | null = null;
    const invoices = [...invoiceRowsPlus1];
    if (invoices.length > INITIAL_INVOICE_LIMIT) {
      const next = invoices.pop();
      invoiceNextCursor = next?.id ?? null;
    }

    return { sub, plans, invoices, invoiceNextCursor, usage };
  });

  if (!data.sub) {
    return (
      <PageContainer>
        <SectionHeader
          title="Billing"
          subtitle="No subscription found for this clinic."
        />
      </PageContainer>
    );
  }

  const flags = parsePlanFeatures(data.sub.plan.features);

  const planRows: BillingPagePlan[] = data.plans.map((p) => {
    const f = parsePlanFeatures(p.features);
    return {
      id: p.id,
      slug: p.slug,
      nameRu: p.nameRu,
      nameUz: p.nameUz,
      priceMonth: p.priceMonth.toString(),
      currency: p.currency,
      maxPatients: f.maxPatients,
      maxAppointmentsPerMonth: f.maxAppointmentsPerMonth,
      maxSmsPerMonth: f.maxSmsPerMonth,
      hasTelegramInbox: f.hasTelegramInbox,
      hasCallCenter: f.hasCallCenter,
      hasAnalyticsPro: f.hasAnalyticsPro,
    };
  });

  const pendingPlanSlug = data.sub.pendingPlanId
    ? data.plans.find((p) => p.id === data.sub!.pendingPlanId)?.slug ?? null
    : null;

  const props2: BillingPageProps = {
    locale,
    stubMode: process.env.NEXT_PUBLIC_BILLING_STUB === "1",
    subscription: {
      planId: data.sub.planId,
      planSlug: data.sub.plan.slug,
      planNameRu: data.sub.plan.nameRu,
      planNameUz: data.sub.plan.nameUz,
      status: data.sub.status,
      trialEndsAt: data.sub.trialEndsAt?.toISOString() ?? null,
      currentPeriodEndsAt: data.sub.currentPeriodEndsAt?.toISOString() ?? null,
      priceMonth: data.sub.plan.priceMonth.toString(),
      pendingPlanSlug,
    },
    flags: {
      maxPatients: flags.maxPatients,
      maxAppointmentsPerMonth: flags.maxAppointmentsPerMonth,
      maxSmsPerMonth: flags.maxSmsPerMonth,
    },
    usage: {
      patientCount: data.usage.patientCount,
      appointmentCountThisMonth: data.usage.appointmentCountThisMonth,
      smsCountThisMonth: data.usage.smsCountThisMonth,
    },
    plans: planRows,
    invoices: data.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      amountTiins: i.amountTiins.toString(),
      currency: i.currency,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      dueAt: i.dueAt.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
    invoiceNextCursor: data.invoiceNextCursor,
    invoicePageSize: INITIAL_INVOICE_LIMIT,
  };

  return <BillingClient {...props2} />;
}
