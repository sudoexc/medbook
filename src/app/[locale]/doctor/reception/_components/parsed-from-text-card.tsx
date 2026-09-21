"use client";

/**
 * The text → structure bridge.
 *
 * The doctor writes prescriptions as prose in the conclusion («Мидокалм
 * 150 мг — по 1 таблетке…») and leaves the constructor empty — which
 * silently disables interaction checks, patient reminders and the Telegram
 * medication card. Instead of retraining the doctor, this card watches the
 * conclusion text and offers every recognised prescription line as a
 * one-click structured row. Parsing is conservative (see conclusion-parse);
 * anything the doctor rejects stays dismissed for this visit.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, WandSparklesIcon, XIcon } from "lucide-react";

import {
  parseConclusionPrescriptions,
  unadoptedCandidates,
  type ParsedPrescription,
} from "@/lib/catalogs/conclusion-parse";
import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";

import type {
  VisitNoteRow,
  VisitPrescriptionDraft,
} from "../_hooks/use-visit-note";

function toDraft(p: ParsedPrescription): VisitPrescriptionDraft {
  return {
    drugId: null,
    displayName: p.displayName,
    form: null,
    strength: p.strength,
    dose: p.strength ?? "1",
    timesOfDay: [],
    mealRelation: p.mealRelation,
    durationDays: p.durationDays,
    instructionRu: p.instruction,
    instructionUz: null,
    remindPatient: true,
  };
}

export function ParsedFromTextCard({
  note,
  disabled,
  onAdopt,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onAdopt: (drafts: VisitPrescriptionDraft[]) => void;
}) {
  const t = useTranslations("doctor.reception");
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());

  const candidates = React.useMemo(() => {
    const parsed = parseConclusionPrescriptions(note.bodyMarkdown);
    const existing = [
      ...(note.visitPrescriptions ?? []).map((r) => r.displayName),
      ...(note.prescriptions ?? []),
    ];
    return unadoptedCandidates(parsed, existing).filter(
      (p) => !dismissed.has(p.sourceLine),
    );
  }, [note.bodyMarkdown, note.visitPrescriptions, note.prescriptions, dismissed]);

  if (disabled || candidates.length === 0) return null;

  const dismiss = (p: ParsedPrescription) =>
    setDismissed((prev) => new Set(prev).add(p.sourceLine));

  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <WandSparklesIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {t("parsedRx.title", { count: candidates.length })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAdopt(candidates.map(toDraft))}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PlusIcon className="size-3" />
          {t("parsedRx.addAll")}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("parsedRx.hint")}
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {candidates.map((p) => (
          <li
            key={p.sourceLine}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {p.displayName}
                {p.strength ? (
                  <span className="ml-1.5 text-muted-foreground">
                    {p.strength}
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {formatPrescriptionLine(toDraft(p), "ru")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onAdopt([toDraft(p)])}
              title={t("parsedRx.addOne")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/20"
            >
              <PlusIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => dismiss(p)}
              title={t("parsedRx.dismiss")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
