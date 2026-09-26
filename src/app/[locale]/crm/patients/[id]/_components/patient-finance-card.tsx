"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CircleDollarSignIcon, CreditCardIcon, WalletIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";

import type { Patient } from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";

export interface PatientFinanceCardProps {
  patient: Patient;
  appointments: PatientAppointment[];
  className?: string;
}

/**
 * «Финансы» on the patient overview (audit PT-08). The money figures come
 * from the server's one formula (`patient.finance`): only COMPLETED visits
 * cost, every PAID payment counts. While the clinic records no payments in
 * the CRM there is no «Долг» at all, only what the visits cost, so the
 * front desk is not told that every patient owes money.
 */
export function PatientFinanceCard({
  patient,
  appointments,
  className,
}: PatientFinanceCardProps) {
  const t = useTranslations("patientCard.finance");
  const finance = patient.finance;
  const attendance = React.useMemo(() => {
    let completed = 0;
    let missed = 0;
    for (const a of appointments) {
      if (a.status === "COMPLETED") completed += 1;
      else if (a.status === "NO_SHOW" || a.status === "SKIPPED") missed += 1;
    }
    const closedVisits = completed + missed;
    const attendancePct =
      closedVisits > 0 ? Math.round((completed / closedVisits) * 100) : 100;
    return { attendancePct, closedVisits };
  }, [appointments]);

  const debt = finance?.debt ?? 0;
  const animatedTotal = useCountUp(finance?.visitsTotal ?? 0);
  const animatedPaid = useCountUp(finance?.paid ?? 0);
  const animatedDebt = useCountUp(debt);
  const animatedPct = useCountUp(attendance.attendancePct);
  const tracksPayments = finance?.tracksPayments === true;

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
        <div className="flex min-w-0 flex-col gap-2">
          <dl className="divide-y divide-border rounded-xl border border-border">
            <FinanceRow
              icon={CircleDollarSignIcon}
              label={t("visitsTotal")}
              value={<MoneyText amount={Math.round(animatedTotal)} currency="UZS" />}
            />
            {tracksPayments ? (
              <>
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
                    debt > 0 ? (
                      <MoneyText amount={Math.round(animatedDebt)} currency="UZS" />
                    ) : (
                      t("zeroSum")
                    )
                  }
                  tone={debt > 0 ? "danger" : undefined}
                />
              </>
            ) : null}
          </dl>
          {finance && !tracksPayments ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("paymentsNotTracked")}
            </p>
          ) : null}
        </div>

        <Donut
          pct={animatedPct}
          label={t("donutAttendance")}
          hint={
            attendance.closedVisits > 0
              ? t("attendanceHint", { count: attendance.closedVisits })
              : t("attendanceEmpty")
          }
        />
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

function Donut({
  pct,
  label,
  hint,
}: {
  pct: number;
  label: string;
  hint: string;
}) {
  const size = 112;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  const ringTone =
    pct >= 90
      ? "text-success"
      : pct >= 70
        ? "text-primary"
        : "text-destructive";
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative flex items-center justify-center">
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
            className={cn("transition-[stroke-dasharray]", ringTone)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">
            {Math.round(pct)}%
          </span>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </div>
  );
}
