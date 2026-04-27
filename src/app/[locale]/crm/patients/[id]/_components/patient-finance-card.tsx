"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CircleDollarSignIcon, CreditCardIcon, WalletIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";
import { Button } from "@/components/ui/button";

import type { Patient } from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";

export interface PatientFinanceCardProps {
  patient: Patient;
  appointments: PatientAppointment[];
  className?: string;
}

export function PatientFinanceCard({
  patient,
  appointments,
  className,
}: PatientFinanceCardProps) {
  const t = useTranslations("patientCard.finance");
  const stats = React.useMemo(() => {
    let billed = 0;
    let paid = 0;
    for (const a of appointments) {
      billed += a.priceFinal ?? 0;
      for (const p of a.payments) {
        if (p.status === "PAID") paid += p.amount;
      }
    }
    const debt = Math.max(0, billed - paid);
    const paidPct = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;
    return {
      total: Math.max(billed, patient.ltv),
      paid,
      debt,
      paidPct,
    };
  }, [appointments, patient.ltv]);

  const animatedTotal = useCountUp(stats.total);
  const animatedPaid = useCountUp(stats.paid);
  const animatedDebt = useCountUp(stats.debt);
  const animatedPct = useCountUp(stats.paidPct);

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4">
        <dl className="divide-y divide-border rounded-xl border border-border">
          <FinanceRow
            icon={CircleDollarSignIcon}
            label={t("totalIncome")}
            value={<MoneyText amount={Math.round(animatedTotal)} currency="UZS" />}
          />
          <FinanceRow
            icon={CreditCardIcon}
            label={t("paid")}
            value={<MoneyText amount={Math.round(animatedPaid)} currency="UZS" />}
            tone="success"
          />
          <FinanceRow
            icon={WalletIcon}
            label={t("debt")}
            value={
              stats.debt > 0 ? (
                <MoneyText amount={Math.round(animatedDebt)} currency="UZS" />
              ) : (
                t("zeroSum")
              )
            }
            tone={stats.debt > 0 ? "danger" : undefined}
          />
        </dl>

        <Donut pct={animatedPct} label={t("donutPaid")} />
      </div>

      <div className="mt-3 flex">
        <Button variant="outline" size="sm" className="ml-auto h-8 text-[12px]">
          {t("editAppointment")}
        </Button>
      </div>
    </section>
  );
}

function FinanceRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CircleDollarSignIcon;
  label: string;
  value: React.ReactNode;
  tone?: "success" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "success"
            ? "text-success"
            : tone === "danger"
              ? "text-destructive"
              : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Donut({ pct, label }: { pct: number; label: string }) {
  const size = 112;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="text-primary transition-[stroke-dasharray]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums text-foreground">
          {Math.round(pct)}%
        </span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
