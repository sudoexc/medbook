"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { sumToTiyin, tiyinToSum } from "@/lib/money-input";
import { tashkentPartsOf } from "@/lib/tashkent-time";
import {
  defaultPaymentVisitId,
  isSettled,
  outstandingTiyin,
  payableVisits,
  type PaymentVisit,
} from "@/lib/payments/visit-choice";

export const PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "TRANSFER",
  "PAYME",
  "CLICK",
  "UZUM",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A visit the payment can be filed under, with what the picker shows. */
export type PaymentVisitOption = PaymentVisit & {
  doctorName: string;
  serviceName: string | null;
};

/** Radix Select has no empty value; this stands for «no visit». */
const NO_VISIT = "__none";

/** How many visits the picker lists; older ones are not paid at the desk. */
const MAX_OPTIONS = 20;

class VisitInvalidError extends Error {}

export interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  visits: PaymentVisitOption[];
  /** The visit drawer: the payment is for this visit, no picker. */
  lockedVisitId?: string;
}

function visitLabel(v: PaymentVisitOption): string {
  const p = tashkentPartsOf(v.date);
  const [y, m, d] = p.date.split("-");
  const time = `${String(p.hours).padStart(2, "0")}:${String(p.minutes).padStart(2, "0")}`;
  return [`${d}.${m}.${y} ${time}`, v.doctorName, v.serviceName]
    .filter(Boolean)
    .join(" · ");
}

/**
 * «Новый платёж», from the patient card or the visit drawer. The payment
 * is filed under a visit (audit AN-02): preselected by
 * `defaultPaymentVisitId`, or fixed by the drawer. The amount starts at
 * what is still owed for that visit until staff type their own.
 */
export function AddPaymentDialog({
  open,
  onOpenChange,
  patientId,
  visits,
  lockedVisitId,
}: AddPaymentDialogProps) {
  const t = useTranslations("patientCard.payments.dialog");
  const tMethod = useTranslations("patientCard.payments.method");
  const tToast = useTranslations("crmToasts.patient");
  const qc = useQueryClient();

  const options = React.useMemo(
    () => payableVisits(visits).slice(0, MAX_OPTIONS),
    [visits],
  );

  const [visitId, setVisitId] = React.useState<string>(NO_VISIT);
  const [amount, setAmount] = React.useState("");
  const [amountTouched, setAmountTouched] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>("CASH");
  // One key per opening: a double click or a retried request files one
  // payment, not two (the route dedupes by it).
  const [idempotencyKey, setIdempotencyKey] = React.useState("");

  const prefill = React.useCallback(
    (id: string) => {
      const v = visits.find((x) => x.id === id);
      const owed = v ? outstandingTiyin(v) : 0;
      setAmount(owed > 0 ? String(tiyinToSum(owed)) : "");
    },
    [visits],
  );

  React.useEffect(() => {
    if (!open) return;
    const initial = lockedVisitId ?? defaultPaymentVisitId(visits) ?? NO_VISIT;
    setVisitId(initial);
    prefill(initial);
    setAmountTouched(false);
    setMethod("CASH");
    setIdempotencyKey(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // Only on opening: a refetch of the visits must not reset what staff typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typed in сум; the grouping spaces of a pasted «150 000» are fine.
  const parsed = sumToTiyin(Number(amount.replace(/[\s\u00a0\u202f]/g, "")));

  const mutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/payments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          appointmentId: visitId === NO_VISIT ? null : visitId,
          amount: parsed,
          currency: "UZS",
          method,
          status: "PAID",
          idempotencyKey,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
        } | null;
        if (
          j?.reason === "appointment_not_found" ||
          j?.reason === "appointment_patient_mismatch"
        ) {
          throw new VisitInvalidError();
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      if (visitId !== NO_VISIT) {
        // The visit is now paid: the drawer, the lists' «Неоплаченные» and
        // the reception board all read its payments.
        const opts = { refetchType: "active" } as const;
        qc.invalidateQueries({ queryKey: ["appointment", visitId], ...opts });
        qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
        qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
        qc.invalidateQueries({ queryKey: ["reception"], ...opts });
        qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
      }
      toast.success(tToast("paymentAdded"));
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error(
        e instanceof VisitInvalidError ? t("visitInvalid") : tToast("paymentFailed"),
      ),
  });

  const canSubmit = parsed > 0 && !mutation.isPending;
  const locked = lockedVisitId
    ? visits.find((v) => v.id === lockedVisitId) ?? null
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="pay-visit">{t("visit")}</Label>
            {lockedVisitId ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                {locked ? visitLabel(locked) : "—"}
              </div>
            ) : (
              <Select
                value={visitId}
                onValueChange={(v) => {
                  setVisitId(v);
                  if (!amountTouched) prefill(v);
                }}
              >
                <SelectTrigger id="pay-visit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {visitLabel(v)}
                      {isSettled(v) ? ` · ${t("visitPaid")}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_VISIT}>{t("visitNone")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pay-amount">{t("amount")}</Label>
            <Input
              id="pay-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountTouched(true);
              }}
              placeholder="150 000"
            />
            <span className="text-xs text-muted-foreground">{t("hint")}</span>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pay-method">{t("method")}</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
            >
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tMethod(m.toLowerCase() as never)}
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
            disabled={mutation.isPending}
          >
            {t("cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? t("saving") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
