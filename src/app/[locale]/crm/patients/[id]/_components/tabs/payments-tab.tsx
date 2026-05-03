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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Patient } from "../../_hooks/use-patient";
import {
  useCreatePayment,
  usePatientPayments,
  type PatientPayment,
} from "../../_hooks/use-patient-payments";

const METHODS: PatientPayment["method"][] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "PAYME",
  "CLICK",
  "UZUM",
  "OTHER",
];

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
  const [addOpen, setAddOpen] = React.useState(false);
  const rows = React.useMemo(() => q.data?.rows ?? [], [q.data?.rows]);

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
      />
    </div>
  );
}

function AddPaymentDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
}) {
  const t = useTranslations("patientCard.payments.dialog");
  const tMethod = useTranslations("patientCard.payments.method");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PatientPayment["method"]>("CASH");

  const create = useCreatePayment(patientId);

  React.useEffect(() => {
    if (!open) {
      setAmount("");
      setMethod("CASH");
    }
  }, [open]);

  const parsed = Math.round(Number(amount.replace(/\s/g, "")) * 100);
  const canSubmit = Number.isFinite(parsed) && parsed > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="pay-amount">{t("amount")}</Label>
            <Input
              id="pay-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150 000"
            />
            <span className="text-xs text-muted-foreground">{t("hint")}</span>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pay-method">{t("method")}</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PatientPayment["method"])}
            >
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tMethod(
                      m.toLowerCase() as
                        | "cash"
                        | "card"
                        | "transfer"
                        | "payme"
                        | "click"
                        | "uzum"
                        | "other",
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              create.mutate(
                {
                  patientId,
                  amount: parsed,
                  method,
                  status: "PAID",
                },
                {
                  onSuccess: () => onOpenChange(false),
                },
              )
            }
          >
            {create.isPending ? t("saving") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
