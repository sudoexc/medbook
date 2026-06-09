"use client";

/**
 * Phase G7 — sick-leave certificate builder.
 *
 * Issues a paper certificate with regimen (амбулаторно / стационар / постельный),
 * period (from / to), and optional restrictions. On success the printable
 * HTML opens in a new tab with auto window.print().
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CalendarIcon,
  Loader2Icon,
  PrinterIcon,
  StethoscopeIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useCreateSickLeave } from "../_hooks/use-clinical-forms";

type Regimen = "OUTPATIENT" | "HOSPITAL" | "HOME";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  patientId: string | null;
  appointmentId: string | null;
  visitNoteId: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
};

// `value` is the enum literal sent to the server; `key` routes to the
// localized label/hint under `sickLeave.regimens.*`.
const REGIMENS: { value: Regimen; key: string }[] = [
  { value: "OUTPATIENT", key: "outpatient" },
  { value: "HOSPITAL", key: "hospital" },
  { value: "HOME", key: "home" },
];

export function SickLeaveDialog({
  open,
  onOpenChange,
  patientId,
  appointmentId,
  visitNoteId,
  diagnosisCode,
  diagnosisName,
}: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const [regimen, setRegimen] = React.useState<Regimen>("OUTPATIENT");
  const [periodFrom, setPeriodFrom] = React.useState("");
  const [periodTo, setPeriodTo] = React.useState("");
  const [restrictions, setRestrictions] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const create = useCreateSickLeave();

  React.useEffect(() => {
    if (!open) return;
    const today = isoDate(new Date());
    setRegimen("OUTPATIENT");
    setPeriodFrom(today);
    setPeriodTo(isoDate(addDays(new Date(), 6)));
    setRestrictions("");
    setNotes("");
  }, [open]);

  const days =
    periodFrom && periodTo
      ? Math.max(
          0,
          Math.round(
            (new Date(periodTo).getTime() - new Date(periodFrom).getTime()) /
              86400000,
          ) + 1,
        )
      : 0;

  const handleSubmit = () => {
    if (!patientId || !periodFrom || !periodTo) return;
    create.mutate(
      {
        patientId,
        appointmentId,
        visitNoteId,
        diagnosisCode,
        diagnosisName,
        regimen,
        periodFrom,
        periodTo,
        restrictions: restrictions.trim() || null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  const canSubmit =
    !!patientId &&
    !!periodFrom &&
    !!periodTo &&
    new Date(periodTo) >= new Date(periodFrom) &&
    !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StethoscopeIcon className="size-4" /> {t("sickLeave.title")}
          </DialogTitle>
          <DialogDescription>
            {t("sickLeave.description")}
          </DialogDescription>
        </DialogHeader>

        {!patientId ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {t("sickLeave.noPatientHint")}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-muted-foreground">
              {t("common.icd10")}:{" "}
              <span className="font-medium text-foreground">
                {diagnosisCode ?? "—"}
              </span>
              {diagnosisName ? (
                <span className="ml-1 text-muted-foreground">· {diagnosisName}</span>
              ) : null}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {t("sickLeave.regimenLabel")}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {REGIMENS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRegimen(r.value)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                      regimen === r.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    <span className="font-semibold">{t(`sickLeave.regimens.${r.key}.label`)}</span>
                    <span className="text-[10px] text-muted-foreground">{t(`sickLeave.regimens.${r.key}.hint`)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DateField label={t("sickLeave.from")} value={periodFrom} onChange={setPeriodFrom} />
              <DateField label={t("sickLeave.to")} value={periodTo} onChange={setPeriodTo} />
            </div>
            {days > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarIcon className="size-3" />
                {t("sickLeave.calendarDays")} <b className="text-foreground">{days}</b>
              </div>
            )}

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                {t("sickLeave.restrictionsLabel")}
              </span>
              <textarea
                className="min-h-[60px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={restrictions}
                onChange={(e) => setRestrictions(e.target.value)}
                placeholder={t("sickLeave.restrictionsPlaceholder")}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">{t("sickLeave.notesLabel")}</span>
              <textarea
                className="min-h-[44px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {create.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {t("sickLeave.submitError")}{" "}
                {(create.error as Error)?.message ?? t("common.errorFallback")}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            <XIcon className="size-3.5" />
            {t("actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {create.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PrinterIcon className="size-3.5" />
            )}
            {t("sickLeave.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
