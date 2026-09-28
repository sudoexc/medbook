/**
 * /admin/clinics/[id]/billing — SUPER_ADMIN tariff control plane.
 *
 * Server-rendered initial state: this RSC loads the clinic, its subscription
 * (creating a TRIAL on `pro` if missing — same defensive path as the API),
 * and the catalog of active plans. The interactive controls live in a client
 * component (`BillingPageClient`) which calls `router.refresh()` on each
 * successful mutation so we never serialize stale rows back to the user.
 *
 * Layout/styling matches the existing `/admin/clinics/[id]/integrations` page.
 */
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  SUPER_ADMIN_ENROL_PATH,
  adminPageAccess,
} from "@/server/platform/admin-page-gate";

import { BillingPageClient } from "./_components/billing-page-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function loadInitialState(clinicId: string) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, slug: true, nameRu: true, nameUz: true },
  });
  if (!clinic) return null;

  let sub = await prisma.subscription.findUnique({
    where: { clinicId: clinic.id },
    include: { plan: true },
  });
  if (!sub) {
    const fallbackPlan =
      (await prisma.plan.findUnique({ where: { slug: "pro" } })) ??
      (await prisma.plan.findFirst({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      }));
    if (fallbackPlan) {
      sub = await prisma.subscription.create({
        data: {
          clinicId: clinic.id,
          planId: fallbackPlan.id,
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() + THIRTY_DAYS_MS),
        },
        include: { plan: true },
      });
    }
  }

  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
  });

  return { clinic, subscription: sub, plans };
}

export default async function BillingPage({ params }: PageProps) {
  const { id } = await params;
  // The page loads (and may create) tenant rows itself, so it checks access
  // itself too (audit SEC-08): a soft navigation renders this segment
  // without re-running the layout's gate.
  const access = await adminPageAccess();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "owes_mfa") redirect(SUPER_ADMIN_ENROL_PATH);
  if (access.kind === "forbidden") notFound();

  const data = await runWithTenant(
    { kind: "SUPER_ADMIN", userId: access.userId },
    () => loadInitialState(id),
  );
  if (!data) notFound();

  // Serialize Decimals / Dates for the Client Component (Decimal is not
  // structurally cloneable; toString() makes it portable).
  const initial = {
    clinic: data.clinic,
    subscription: data.subscription
      ? {
          id: data.subscription.id,
          clinicId: data.subscription.clinicId,
          planId: data.subscription.planId,
          status: data.subscription.status,
          trialEndsAt: data.subscription.trialEndsAt?.toISOString() ?? null,
          currentPeriodEndsAt:
            data.subscription.currentPeriodEndsAt?.toISOString() ?? null,
          cancelledAt: data.subscription.cancelledAt?.toISOString() ?? null,
          plan: {
            id: data.subscription.plan.id,
            slug: data.subscription.plan.slug,
            nameRu: data.subscription.plan.nameRu,
            nameUz: data.subscription.plan.nameUz,
            priceMonth: data.subscription.plan.priceMonth.toString(),
            currency: data.subscription.plan.currency,
            features: data.subscription.plan.features,
            sortOrder: data.subscription.plan.sortOrder,
          },
        }
      : null,
    plans: data.plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      nameRu: p.nameRu,
      nameUz: p.nameUz,
      priceMonth: p.priceMonth.toString(),
      currency: p.currency,
      features: p.features,
      sortOrder: p.sortOrder,
    })),
  };

  return <BillingPageClient initial={initial} />;
}
