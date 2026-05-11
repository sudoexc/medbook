"use client";

import * as React from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PayStubClientProps {
  locale: string;
  stubMode: boolean;
  invoice: {
    id: string;
    number: string;
    status: string;
    amountTiins: string;
    currency: string;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
  };
}

type Provider = "click" | "payme";

function formatTiinsAsUzs(amountTiins: string): string {
  const minor = Number(amountTiins);
  if (!Number.isFinite(minor)) return "0 UZS";
  const whole = Math.trunc(minor / 100);
  const sign = whole < 0 ? "-" : "";
  const abs = Math.abs(whole).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} UZS`;
}

export function PayStubClient(props: PayStubClientProps) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [busyProvider, setBusyProvider] = React.useState<Provider | null>(null);
  const [busySimulate, setBusySimulate] = React.useState(false);

  async function onSimulate() {
    if (busySimulate) return;
    setBusySimulate(true);
    try {
      const res = await fetch(
        `/api/crm/billing/invoices/${props.invoice.id}/simulate-pay`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(t("errors.simulate", { error: j?.error ?? "unknown" }));
        return;
      }
      toast.success(t("pay.success"));
      router.push(`/${props.locale}/crm/settings/billing`);
      router.refresh();
    } catch (e) {
      toast.error(t("errors.simulate", { error: String(e) }));
    } finally {
      setBusySimulate(false);
    }
  }

  async function onPayWith(provider: Provider) {
    if (busyProvider) return;
    setBusyProvider(provider);
    try {
      const res = await fetch(
        `/api/crm/billing/invoices/${props.invoice.id}/charge?locale=${encodeURIComponent(props.locale)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { payUrl?: string; isStub?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.payUrl) {
        toast.error(
          t("errors.charge", {
            provider,
            error: data?.error ?? `HTTP ${res.status}`,
          }),
        );
        return;
      }
      if (data.isStub) {
        toast.error(t("errors.providerNotConfigured", { provider }));
        return;
      }
      // Real provider URL — redirect the browser away to the checkout
      // page. After completion the provider redirects back to
      // /<locale>/crm/settings/billing where the invoice status reflects
      // the webhook's outcome.
      window.location.href = data.payUrl;
    } catch (e) {
      toast.error(t("errors.charge", { provider, error: String(e) }));
    } finally {
      setBusyProvider(null);
    }
  }

  const isPaid = props.invoice.status === "PAID";

  return (
    <PageContainer>
      <SectionHeader title={t("pay.title")} subtitle={t("pay.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="font-mono">{props.invoice.number}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("pay.status")}</span>
              <Badge variant={isPaid ? "default" : "secondary"}>
                {props.invoice.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("pay.amount")}</span>
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {formatTiinsAsUzs(props.invoice.amountTiins)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("pay.period")}</span>
              <span className="tabular-nums text-foreground">
                {props.invoice.periodStart.slice(0, 10)} —{" "}
                {props.invoice.periodEnd.slice(0, 10)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("pay.dueAt")}</span>
              <span className="tabular-nums text-foreground">
                {props.invoice.dueAt.slice(0, 10)}
              </span>
            </div>
          </div>

          {!isPaid ? (
            <div className="grid grid-cols-1 gap-2 pt-4 sm:grid-cols-2">
              <Button
                onClick={() => onPayWith("click")}
                disabled={busyProvider !== null}
                className="w-full"
              >
                {busyProvider === "click"
                  ? t("pay.redirecting")
                  : t("pay.payWithClick")}
              </Button>
              <Button
                onClick={() => onPayWith("payme")}
                disabled={busyProvider !== null}
                variant="secondary"
                className="w-full"
              >
                {busyProvider === "payme"
                  ? t("pay.redirecting")
                  : t("pay.payWithPayme")}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-3">
            {props.stubMode && !isPaid ? (
              <Button
                onClick={onSimulate}
                disabled={busySimulate || busyProvider !== null}
                variant="outline"
                size="sm"
              >
                {busySimulate ? t("pay.simulating") : t("pay.simulateButton")}
              </Button>
            ) : null}
            <a
              href={`/api/crm/billing/invoices/${props.invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t("pay.downloadPdf")}
            </a>
            <Link
              href={`/${props.locale}/crm/settings/billing`}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t("pay.back")}
            </Link>
          </div>

          {!isPaid ? (
            <p className="pt-4 text-xs text-muted-foreground">
              {t("pay.realProviderNote")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
