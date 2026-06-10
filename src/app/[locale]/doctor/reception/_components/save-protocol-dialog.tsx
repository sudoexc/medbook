"use client";

/**
 * Ф3 (TZ-smart-constructor) — «Сохранить приём как протокол».
 *
 * Snapshots the current visit note (section chips + structured prescription
 * rows + advice) into a personal ClinicalProtocol for the logged-in doctor.
 * Once saved, the same diagnosis surfaces the protocol via «Применить
 * стандарт» — one click re-creates the whole visit. The note itself is not
 * mutated, so saving works for finalized notes too.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { BookmarkPlusIcon, CheckIcon, Loader2Icon, PillIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";

import { useCreateProtocol } from "../_hooks/use-clinical-protocols";
import type { VisitNoteRow } from "../_hooks/use-visit-note";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  note: VisitNoteRow | null;
};

export function SaveProtocolDialog({ open, onOpenChange, note }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const locale = useLocale() === "uz" ? "uz" : "ru";
  const create = useCreateProtocol();
  const [name, setName] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  const resetMutation = create.reset;
  React.useEffect(() => {
    if (open && note) {
      setName(note.diagnosisName ?? "");
      setPrefix(note.diagnosisCode ?? "");
      setSaved(false);
      resetMutation();
    }
  }, [open, note, resetMutation]);

  if (!note) return null;

  const drafts = (note.visitPrescriptions ?? []).map(
    ({ id: _id, sortOrder: _s, ...rest }) => rest,
  );
  const rxLines = drafts.map((d) => formatPrescriptionLine(d, locale));
  const chipCounts: Array<[string, number]> = [
    [t("applyProtocol.sections.complaints"), (note.complaints ?? []).length],
    [t("applyProtocol.sections.anamnesis"), (note.anamnesis ?? []).length],
    [t("applyProtocol.sections.examination"), (note.examination ?? []).length],
    [t("applyProtocol.sections.advice"), (note.advice ?? []).length],
  ];
  const hasContent =
    chipCounts.some(([, n]) => n > 0) ||
    drafts.length > 0 ||
    (note.prescriptions ?? []).length > 0;
  const canSave =
    hasContent &&
    name.trim().length > 0 &&
    prefix.trim().length > 0 &&
    !create.isPending;

  const handleSave = () => {
    if (!canSave) return;
    create.mutate(
      {
        diagnosisCodePrefix: prefix.trim().toUpperCase(),
        nameRu: name.trim(),
        complaintsTemplate: note.complaints ?? [],
        anamnesisTemplate: note.anamnesis ?? [],
        examinationTemplate: note.examination ?? [],
        prescriptionsTemplate: note.prescriptions ?? [],
        prescriptionItems: drafts,
        adviceTemplate: note.advice ?? [],
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookmarkPlusIcon className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base">
                {t("saveProtocol.title")}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t("saveProtocol.description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {saved ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckIcon className="size-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">
              {t("saveProtocol.success")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("saveProtocol.successHint", {
                prefix: prefix.trim().toUpperCase(),
              })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                {t("saveProtocol.nameLabel")}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("saveProtocol.namePlaceholder")}
                className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                {t("saveProtocol.prefixLabel")}
              </span>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="G43"
                className="h-9 w-32 rounded-lg border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-[11px] text-muted-foreground">
                {t("saveProtocol.prefixHint")}
              </span>
            </label>

            <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {chipCounts
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => (
                    <span key={label}>
                      {label}: <b className="text-foreground">{n}</b>
                    </span>
                  ))}
              </div>
              {rxLines.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {rxLines.map((line) => (
                    <li key={line} className="flex items-start gap-1">
                      <PillIcon className="mt-0.5 size-3 shrink-0 text-primary/70" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!hasContent && (
                <p className="italic">{t("saveProtocol.empty")}</p>
              )}
            </div>

            {create.isError && (
              <p className="text-xs text-destructive">
                {t("common.errorFallback")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {saved ? (
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {t("actions.close")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button size="sm" disabled={!canSave} onClick={handleSave}>
                {create.isPending ? (
                  <Loader2Icon className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <BookmarkPlusIcon className="mr-1 size-3.5" />
                )}
                {t("saveProtocol.save")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
