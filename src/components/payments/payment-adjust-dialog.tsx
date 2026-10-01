"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, type Locale } from "@/lib/format";
import { parseSumInput, tiyinToSum } from "@/lib/money-input";
import { refundInstantFor } from "@/lib/payments/refund-date";
import { tashkentDateOf, tashkentToday } from "@/lib/tashkent-time";

export type AdjustablePayment = {
  id: string;
  amount: number;
  paidAt: string | null;
  createdAt: string;
};

export type PaymentAdjustMode = "amount" | "refund";

export interface PaymentAdjustDialogProps {
  mode: PaymentAdjustMode;
  payment: AdjustablePayment | null;
  patientId: string;
  onOpenChange: (open: boolean) => void;
}

/** Server refusals staff can act on; anything else is a generic failure. */
const KNOWN_REASONS = new Set([
  "amount_locked_after_refund",
  "already_refunded",
  "refund_exceeds_amount",
  "refund_date_invalid",
  "payment_changed",
  "amount_admin_only",
]);

class AdjustError extends Error {
  constructor(readonly reason: string | null) {
    super(reason ?? "failed");
  }
}

/**
 * «Исправить сумму» and «Возврат» for one recorded payment (audit AN-11).
 * The amount is typed in сум through the same parser as a new payment, so
 * «150.000» is 150 000; the refund also asks for the day it was given back.
 */
export function PaymentAdjustDialog({
  mode,
  payment,
  patientId,
  onOpenChange,
}: PaymentAdjustDialogProps) {
  const t = useTranslations("patientCard.payments.adjust");
  const locale = useLocale() as Locale;
  const qc = useQueryClient();
  const today = tashkentToday();

  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(today);

  React.useEffect(() => {
    if (!payment) return;
    setAmount(String(tiyinToSum(payment.amount)));
    setDate(tashkentToday());
  }, [payment, mode]);

  const parsed = parseSumInput(amount);
  const tiyin = parsed.ok ? parsed.tiyin : 0;
  const paidAt = payment ? (payment.paidAt ?? payment.createdAt) : null;
  const dateCheck = refundInstantFor(date, today, paidAt);

  let amountError: string | null = null;
  if (!parsed.ok && parsed.reason !== "empty") {
    amountError = parsed.reason === "too_large" ? t("amountTooLarge") : t("amountInvalid");
  } else if (mode === "refund" && payment && tiyin > payment.amount) {
    amountError = t("refundTooLarge");
  }

  const mutation = useMutation<unknown, AdjustError, void>({
    mutationFn: async () => {
      if (!payment) return;
      const body =
        mode === "amount"
          ? { amount: tiyin }
          : {
              refundedAmount: tiyin,
              ...(dateCheck.ok && dateCheck.refundedAt
                ? { refundedAt: dateCheck.refundedAt.toISOString() }
                : {}),
            };
      const res = await fetch(`/api/crm/payments/${payment.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { reason?: string } | null;
        throw new AdjustError(j?.reason ?? null);
      }
      return res.json();
    },
    onSuccess: () => {
      // The card's payments, LTV, balance, and the visit's paid state.
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient-appointments", patientId] });
      toast.success(mode === "amount" ? t("amountSaved") : t("refundSaved"));
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error(
        e.reason && KNOWN_REASONS.has(e.reason)
          ? t(`errors.${e.reason}` as never)
          : t("errors.generic"),
      ),
  });

  const unchanged = mode === "amount" && payment !== null && tiyin === payment.amount;
  const canSubmit =
    payment !== null &&
    tiyin > 0 &&
    amountError === null &&
    !unchanged &&
    (mode === "amount" || dateCheck.ok) &&
    !mutation.isPending;

  return (
    <Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "amount" ? t("amountTitle") : t("refundTitle")}
          </DialogTitle>
          <DialogDescription>
            {payment
              ? t("paymentLine", {
                  amount: formatMoney(payment.amount, "UZS", locale),
                  date: paidAt
                    ? tashkentDateOf(paidAt).split("-").reverse().join(".")
                    : "",
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="pay-adjust-amount">
              {mode === "amount" ? t("newAmount") : t("refundAmount")}
            </Label>
            <Input
              id="pay-adjust-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amountError ? true : undefined}
            />
            {amountError ? (
              <span className="text-xs text-destructive">{amountError}</span>
            ) : tiyin > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("preview", { amount: formatMoney(tiyin, "UZS", locale) })}
              </span>
            ) : null}
          </div>
          {mode === "refund" ? (
            <div className="grid gap-1">
              <Label htmlFor="pay-adjust-date">{t("refundDate")}</Label>
              <Input
                id="pay-adjust-date"
                type="date"
                value={date}
                max={today}
                min={paidAt ? tashkentDateOf(paidAt) : undefined}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={dateCheck.ok ? undefined : true}
              />
              <span
                className={
                  dateCheck.ok
                    ? "text-xs text-muted-foreground"
                    : "text-xs text-destructive"
                }
              >
                {dateCheck.ok ? t("refundHint") : t("refundDateInvalid")}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t("amountHint")}</span>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            variant={mode === "refund" ? "destructive" : "default"}
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t("saving")
              : mode === "amount"
                ? t("amountSubmit")
                : t("refundSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
