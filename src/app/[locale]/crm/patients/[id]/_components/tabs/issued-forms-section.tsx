"use client";

/**
 * «Выданные рецепты и больничные» under the patient's documents (audit
 * CD-07). New forms are no longer issued from the CRM
 * (`@/lib/clinical-forms-issuing`); this register is how the clinic finds a
 * form issued earlier, prints it again, or cancels it with a reason, after
 * which its public QR check answers «АННУЛИРОВАН».
 *
 * Hidden when the patient has none, so a clinic that never issued forms
 * sees nothing new. Staff without access to medical data never query it.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { BanIcon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, type Locale } from "@/lib/format";

import { isClinicAdmin } from "@/lib/permissions/clinic-admin";
import { canViewMedical, useCurrentRole } from "../../_hooks/use-current-role";
import {
  issuedFormPrintHref,
  useCancelIssuedForm,
  useIssuedForms,
  type IssuedForm,
} from "../../_hooks/use-issued-forms";

export function IssuedFormsSection({ patientId }: { patientId: string }) {
  const t = useTranslations("patientCard.documents.issuedForms");
  const locale = useLocale() as Locale;
  const role = useCurrentRole();
  // Same roles the list routes serve (a refusal just leaves it hidden);
  // ADMIN alone may cancel here (the routes also let the issuing doctor,
  // who works in his cabinet), the owner inside a clinic as its admin
  // (owner request 09.10.2026).
  const canSee = canViewMedical(role);
  const canCancel = isClinicAdmin(role);
  const forms = useIssuedForms(patientId, canSee);
  const cancel = useCancelIssuedForm(patientId);
  const [target, setTarget] = React.useState<IssuedForm | null>(null);
  const [reason, setReason] = React.useState("");

  if (!canSee || !forms.data || forms.data.length === 0) return null;

  const statusOf = (f: IssuedForm) => {
    if (f.status === "CANCELLED") return { label: t("statusCancelled"), tone: "text-destructive" };
    if (f.expired) return { label: t("statusExpired"), tone: "text-muted-foreground" };
    return { label: t("statusActive"), tone: "text-success" };
  };

  const submitCancel = async () => {
    if (!target || !reason.trim()) return;
    try {
      await cancel.mutateAsync({ form: target, reason: reason.trim() });
      toast.success(t("cancelled"));
      setTarget(null);
      setReason("");
    } catch {
      toast.error(t("cancelError"));
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold text-foreground">{t("title")}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      <ul className="mt-3 divide-y divide-border">
        {forms.data.map((f) => {
          const status = statusOf(f);
          return (
            <li
              key={`${f.kind}:${f.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="font-medium text-foreground">
                {f.kind === "rx" ? t("kindRx") : t("kindSl")}
              </span>
              <span className="tabular-nums text-muted-foreground">{f.number}</span>
              <span className="text-muted-foreground">
                {f.kind === "sl" && f.periodFrom && f.periodTo
                  ? t("period", {
                      from: formatDate(f.periodFrom, locale, "short"),
                      to: formatDate(f.periodTo, locale, "short"),
                    })
                  : t("issuedOn", { date: formatDate(f.issuedAt, locale, "short") })}
              </span>
              {f.doctorName ? (
                <span className="text-muted-foreground">{f.doctorName}</span>
              ) : null}
              <span
                className={`text-xs font-semibold ${status.tone}`}
                title={f.cancelReason ?? undefined}
              >
                {status.label}
              </span>
              <span className="ml-auto flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(issuedFormPrintHref(f), "_blank", "noopener")}
                >
                  <PrinterIcon className="size-3" />
                  {t("print")}
                </Button>
                {canCancel && f.status === "ISSUED" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReason("");
                      setTarget(f);
                    }}
                  >
                    <BanIcon className="size-3" />
                    {t("cancel")}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <Dialog open={target !== null} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("cancelTitle", { number: target?.number ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("cancelHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("cancelReasonPlaceholder")}
            aria-label={t("cancelReasonPlaceholder")}
            rows={3}
            maxLength={500}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={cancel.isPending}
            >
              {t("cancelBack")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitCancel()}
              disabled={!reason.trim() || cancel.isPending}
            >
              {t("cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
