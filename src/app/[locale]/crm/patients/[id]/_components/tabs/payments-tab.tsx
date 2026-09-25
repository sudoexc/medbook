"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon, WalletIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { TagChip } from "@/components/atoms/tag-chip";
import {
  AddPaymentDialog,
  type PaymentVisitOption,
} from "@/components/payments/add-payment-dialog";

import type { Patient } from "../../_hooks/use-patient";
import {
  usePatientPayments,
  type PatientPayment,
} from "../../_hooks/use-patient-payments";
import { usePatientAppointments } from "../../_hooks/use-patient-appointments";

const STATUS_TONE: Record<
  PatientPayment["status"],
  "success" | "warning" | "neutral" | "info"
> = {
  PAID: "success",
  PARTIAL: "warning",
  UNPAID: "warning",
  REFUNDED: "neutral",
};

export interface PaymentsTabProps {
  patient: Patient;
}

export function PaymentsTab({ patient }: PaymentsTabProps) {
  const t = useTranslations("patientCard.payments");
  const tMethod = useTranslations("patientCard.payments.method");
  const tStatus = useTranslations("patientCard.payments.status");
  const locale = useLocale() as Locale;

  const q = usePatientPayments(patient.id);
  const apptsQ = usePatientAppointments(patient.id);
  const [addOpen, setAddOpen] = React.useState(false);
  const rows = React.useMemo(() => q.data?.rows ?? [], [q.data?.rows]);

  // The visits a new payment can be filed under (audit AN-02).
  const visits = React.useMemo<PaymentVisitOption[]>(
    () =>
      (apptsQ.data?.rows ?? []).map((a) => ({
        id: a.id,
        date: a.date,
        status: a.status,
        priceFinal: a.priceFinal,
        payments: a.payments,
        doctorName: locale === "uz" ? a.doctor.nameUz : a.doctor.nameRu,
        serviceName: a.primaryService
          ? locale === "uz"
            ? a.primaryService.nameUz
            : a.primaryService.nameRu
          : null,
      })),
    [apptsQ.data?.rows, locale],
  );

  const totals = React.useMemo(() => {
    const paid = rows
      .filter((r) => r.status === "PAID")
      .reduce((acc, r) => acc + r.amount, 0);
    const debt = rows
      .filter((r) => r.status === "UNPAID" || r.status === "PARTIAL")
      .reduce((acc, r) => acc + r.amount, 0);
    return { paid, debt };
  }, [rows]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">
            {t("total")}
          </div>
          <div className="mt-1 text-xl font-semibold">
            <MoneyText amount={totals.paid} currency="UZS" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">
            {t("ltv")}
          </div>
          <div className="mt-1 text-xl font-semibold">
            <MoneyText amount={patient.ltv} currency="UZS" />
          </div>
        </div>
        <div
          className={cn(
            "rounded-xl border p-4",
            patient.balance < 0
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-card",
          )}
        >
          <div className="text-xs uppercase text-muted-foreground">
            {t("balance")}
          </div>
          <div
            className={cn(
              "mt-1 text-xl font-semibold",
              patient.balance < 0 && "text-destructive",
            )}
          >
            <MoneyText amount={patient.balance} currency="UZS" />
          </div>
          {totals.debt > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("openInvoices")}:{" "}
              <MoneyText amount={totals.debt} currency="UZS" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t("count", { count: rows.length })}
        </span>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" />
          {t("add")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<WalletIcon />}
          title={t("empty")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[140px_140px_140px_120px_1fr] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t("date")}</span>
            <span>{t("amount")}</span>
            <span>{t("methodCol")}</span>
            <span>{t("statusCol")}</span>
            <span>{t("appointment")}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[140px_140px_140px_120px_1fr] gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0"
            >
              <span className="tabular-nums text-foreground">
                {formatDate(row.paidAt ?? row.createdAt, locale, "short")}
              </span>
              <span className="font-medium">
                <MoneyText
                  amount={row.amount}
                  currency={row.currency}
                  showDual={false}
                />
              </span>
              <span className="text-muted-foreground">
                {tMethod(
                  row.method.toLowerCase() as
                    | "cash"
                    | "card"
                    | "transfer"
                    | "payme"
                    | "click"
                    | "uzum"
                    | "other",
                )}
              </span>
              <span>
                <TagChip
                  color={STATUS_TONE[row.status]}
                  label={tStatus(
                    row.status.toLowerCase() as
                      | "paid"
                      | "unpaid"
                      | "partial"
                      | "refunded",
                  )}
                />
              </span>
              <span className="truncate text-muted-foreground">
                {row.appointment
                  ? formatDate(row.appointment.date, locale, "short")
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      <AddPaymentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        patientId={patient.id}
        visits={visits}
      />
    </div>
  );
}
