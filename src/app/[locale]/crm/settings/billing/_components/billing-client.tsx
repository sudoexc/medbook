"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BillingPagePlan {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  priceMonth: string;
  currency: string;
  maxPatients: number;
  maxAppointmentsPerMonth: number;
  maxSmsPerMonth: number;
  hasTelegramInbox: boolean;
  hasCallCenter: boolean;
  hasAnalyticsPro: boolean;
}

export interface BillingPageInvoice {
  id: string;
  number: string;
  status: string;
  amountTiins: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface BillingPageProps {
  locale: string;
  stubMode: boolean;
  subscription: {
    planId: string;
    planSlug: string;
    planNameRu: string;
    planNameUz: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    priceMonth: string;
    pendingPlanSlug: string | null;
  };
  flags: {
    maxPatients: number;
    maxAppointmentsPerMonth: number;
    maxSmsPerMonth: number;
  };
  usage: {
    patientCount: number;
    appointmentCountThisMonth: number;
    smsCountThisMonth: number;
  };
  plans: BillingPagePlan[];
  invoices: BillingPageInvoice[];
}

function formatTiinsAsUzs(amountTiins: string): string {
  const minor = Number(amountTiins);
  if (!Number.isFinite(minor)) return "0 UZS";
  const whole = Math.trunc(minor / 100);
  const sign = whole < 0 ? "-" : "";
  const abs = Math.abs(whole).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} UZS`;
}

function formatDecimalAsUzs(price: string): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return "0 UZS";
  const whole = Math.trunc(n);
  const sign = whole < 0 ? "-" : "";
  const abs = Math.abs(whole).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} UZS`;
}

function pctBand(current: number, max: number): {
  pct: number;
  tone: "ok" | "warn" | "block";
} {
  if (max < 0 || max === 0) return { pct: 0, tone: "ok" };
  const ratio = current / max;
  const pct = Math.min(999, Math.round(ratio * 100));
  if (ratio >= 1) return { pct, tone: "block" };
  if (ratio >= 0.8) return { pct, tone: "warn" };
  return { pct, tone: "ok" };
}

function UsageBar({
  label,
  current,
  max,
}: {
  label: string;
  current: number;
  max: number;
}) {
  const band = pctBand(current, max);
  const fillPct = Math.min(100, band.pct);
  const trackTone =
    band.tone === "block"
      ? "bg-red-100 dark:bg-red-900/30"
      : band.tone === "warn"
      ? "bg-amber-100 dark:bg-amber-900/30"
      : "bg-muted";
  const fillTone =
    band.tone === "block"
      ? "bg-red-600"
      : band.tone === "warn"
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {current.toLocaleString("ru-RU")}
          {max > 0 ? ` / ${max.toLocaleString("ru-RU")}` : ""}
          {max > 0 ? ` (${band.pct}%)` : ""}
          {max < 0 ? " / ∞" : ""}
        </span>
      </div>
      <div
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full",
          trackTone,
        )}
      >
        {max > 0 ? (
          <div
            className={cn("h-full transition-all", fillTone)}
            style={{ width: `${fillPct}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function statusBadgeTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "PAID":
      return "default";
    case "DRAFT":
      return "secondary";
    case "ISSUED":
      return "secondary";
    case "OVERDUE":
      return "destructive";
    case "VOID":
      return "outline";
    default:
      return "secondary";
  }
}

export function BillingClient(props: BillingPageProps) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function onUpgrade(planSlug: string) {
    if (busy) return;
    setBusy(planSlug);
    try {
      const res = await fetch(
        `/api/crm/billing/upgrade?locale=${encodeURIComponent(props.locale)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetPlanSlug: planSlug }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(t("errors.upgrade", { error: j?.error ?? "unknown" }));
        return;
      }
      const data = (await res.json()) as { payUrl: string };
      router.push(data.payUrl);
    } catch (e) {
      toast.error(t("errors.upgrade", { error: String(e) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="motion-stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1 motion-rise-in">
          <CardHeader>
            <CardTitle>{t("currentPlan.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold uppercase tracking-wide text-foreground">
                  {props.subscription.planSlug}
                </span>
                <Badge variant="secondary">
                  {t(`status.${props.subscription.status.toLowerCase()}` as never)}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {props.locale === "uz"
                  ? props.subscription.planNameUz
                  : props.subscription.planNameRu}
              </div>
              <div className="text-sm text-foreground">
                {t("currentPlan.price", {
                  price: formatDecimalAsUzs(props.subscription.priceMonth),
                })}
              </div>
              {props.subscription.trialEndsAt ? (
                <div className="text-xs text-muted-foreground">
                  {t("currentPlan.trialEndsAt", {
                    date: new Date(props.subscription.trialEndsAt)
                      .toISOString()
                      .slice(0, 10),
                  })}
                </div>
              ) : null}
              {props.subscription.currentPeriodEndsAt ? (
                <div className="text-xs text-muted-foreground">
                  {t("currentPlan.nextBillingAt", {
                    date: new Date(props.subscription.currentPeriodEndsAt)
                      .toISOString()
                      .slice(0, 10),
                  })}
                </div>
              ) : null}
              {props.subscription.pendingPlanSlug ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  {t("currentPlan.pendingUpgrade", {
                    plan: props.subscription.pendingPlanSlug,
                  })}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 motion-rise-in">
          <CardHeader>
            <CardTitle>{t("usage.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <UsageBar
                label={t("usage.patients")}
                current={props.usage.patientCount}
                max={props.flags.maxPatients}
              />
              <UsageBar
                label={t("usage.appointments")}
                current={props.usage.appointmentCountThisMonth}
                max={props.flags.maxAppointmentsPerMonth}
              />
              <UsageBar
                label={t("usage.sms")}
                current={props.usage.smsCountThisMonth}
                max={props.flags.maxSmsPerMonth}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("planPicker.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="motion-stagger grid grid-cols-1 gap-3 md:grid-cols-3">
            {props.plans.map((plan) => {
              const isCurrent = plan.id === props.subscription.planId;
              const planName =
                props.locale === "uz" ? plan.nameUz : plan.nameRu;
              return (
                <div
                  key={plan.id}
                  className={cn(
                    "motion-rise-in motion-hover-lift flex flex-col gap-3 rounded-lg border p-4",
                    isCurrent
                      ? "border-primary/50 bg-primary/[0.04]"
                      : "border-border bg-card",
                  )}
                >
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {plan.slug}
                    </div>
                    <div className="text-base font-semibold text-foreground">
                      {planName}
                    </div>
                  </div>
                  <div className="text-xl font-semibold text-foreground">
                    {formatDecimalAsUzs(plan.priceMonth)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / {t("planPicker.month")}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <li>
                      {t("planPicker.features.patients", {
                        n:
                          plan.maxPatients < 0
                            ? "∞"
                            : plan.maxPatients.toLocaleString("ru-RU"),
                      })}
                    </li>
                    <li>
                      {t("planPicker.features.appointments", {
                        n:
                          plan.maxAppointmentsPerMonth < 0
                            ? "∞"
                            : plan.maxAppointmentsPerMonth.toLocaleString("ru-RU"),
                      })}
                    </li>
                    <li>
                      {t("planPicker.features.sms", {
                        n:
                          plan.maxSmsPerMonth < 0
                            ? "∞"
                            : plan.maxSmsPerMonth.toLocaleString("ru-RU"),
                      })}
                    </li>
                    {plan.hasTelegramInbox ? <li>{t("planPicker.features.tg")}</li> : null}
                    {plan.hasCallCenter ? <li>{t("planPicker.features.call")}</li> : null}
                    {plan.hasAnalyticsPro ? <li>{t("planPicker.features.analytics")}</li> : null}
                  </ul>
                  <div className="mt-auto pt-2">
                    {isCurrent ? (
                      <Button disabled variant="outline" className="w-full">
                        {t("planPicker.current")}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => onUpgrade(plan.slug)}
                        disabled={busy !== null}
                        className="w-full"
                      >
                        {busy === plan.slug
                          ? t("planPicker.upgrading")
                          : t("planPicker.upgrade", { plan: plan.slug })}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoices.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {props.invoices.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t("invoices.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3">{t("invoices.cols.number")}</th>
                    <th className="py-2 pr-3">{t("invoices.cols.period")}</th>
                    <th className="py-2 pr-3">{t("invoices.cols.amount")}</th>
                    <th className="py-2 pr-3">{t("invoices.cols.status")}</th>
                    <th className="py-2 pr-3">{t("invoices.cols.pdf")}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-foreground">
                        {inv.number}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                        {inv.periodStart.slice(0, 10)} — {inv.periodEnd.slice(0, 10)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-foreground">
                        {formatTiinsAsUzs(inv.amountTiins)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={statusBadgeTone(inv.status)}>
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={`/api/crm/billing/invoices/${inv.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {t("invoices.cols.download")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {props.stubMode ? (
        <p className="text-xs text-muted-foreground">{t("stubModeHint")}</p>
      ) : null}
    </PageContainer>
  );
}
