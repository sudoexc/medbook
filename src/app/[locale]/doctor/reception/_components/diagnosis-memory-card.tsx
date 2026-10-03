"use client";

/**
 * «Обычно при <диагноз>» — at the top of «Назначения», what this doctor
 * usually prescribes and recommends with the visit's diagnosis, each one
 * click away, and «Добавить всё» for the lot.
 *
 * The clinic's request (03.10.2026): the system remembers which
 * prescriptions (drug, dose, schema) and recommendations go with a
 * diagnosis, learned from his own past visits with it, so a doctor who works
 * with the mouse does not find and set the same five drugs on every
 * migraine visit. What counts as usual is decided on the server
 * (src/server/catalog/diagnosis-memory.ts).
 *
 * Nothing lands on its own: a diagnosis is the doctor's assertion and so is
 * a prescription, and the click is the consent. A prescription goes through
 * the constructor's add path (`pickApi`), exactly like a click in the
 * picker's columns: dose first where the catalog cannot give one, the CDS
 * check on the result. A recommendation goes into «Рекомендации». What is on
 * the visit already stays in place, marked, so nothing moves under the
 * cursor between two clicks.
 *
 * With several diagnoses on the visit the main one shows first; a switch
 * lists the others that have anything to offer. A diagnosis he never
 * treated before shows nothing: there is nothing to remember yet.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, HistoryIcon, ListPlusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PrescriptionLocale } from "@/lib/catalogs/prescription-format";
import { formatVisitDiagnosis, visitDiagnosisKey } from "@/lib/visit-diagnoses";

import { diagnosisListOf } from "../_hooks/diagnosis-list";
import {
  adviceChecker,
  memoryChipText,
  memoryToAdd,
} from "../_hooks/diagnosis-columns";
import {
  useDiagnosisMemories,
  type DiagnosisMemory,
} from "../_hooks/use-shortlists";
import { isRepeatClick } from "../_hooks/prescription-columns";
import type { VisitNoteRow } from "../_hooks/use-visit-note";
import type { PrescriptionPickApi } from "./prescription-constructor";

type Props = {
  note: VisitNoteRow;
  pickApi: PrescriptionPickApi;
  /** Adds recommendations to the advice column (deduplicated there). */
  onAddAdvice: (lines: readonly string[]) => void;
};

export function DiagnosisMemoryCard({ note, pickApi, onAddAdvice }: Props) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";

  const diagnoses = React.useMemo(
    () =>
      diagnosisListOf({
        diagnosisCode: note.diagnosisCode,
        diagnosisName: note.diagnosisName,
        additionalDiagnoses: note.additionalDiagnoses,
      }),
    [note.diagnosisCode, note.diagnosisName, note.additionalDiagnoses],
  );
  const memories = useDiagnosisMemories(diagnoses, note.id);

  // The diagnoses with something to offer, in the visit's order: the main
  // one first.
  const offered = diagnoses.flatMap((d, i) => {
    const memory = memories[i]?.data;
    const key = visitDiagnosisKey(d);
    return memory && key && (memory.prescriptions.length > 0 || memory.advice.length > 0)
      ? [{ key, diagnosis: d, memory }]
      : [];
  });

  // The doctor's switch holds while that diagnosis is on the visit; any
  // other change of the set brings the main one back.
  const [chosen, setChosen] = React.useState<string | null>(null);
  const active = offered.find((o) => o.key === chosen) ?? offered[0];
  if (!active) return null;

  const adviceOnVisit = adviceChecker(note.advice ?? []);
  const pending = memoryToAdd(active.memory, pickApi.isOnVisit, adviceOnVisit);
  const nothingLeft = pending.items.length === 0 && pending.lines.length === 0;

  const addAll = () => {
    if (pending.items.length > 0) pickApi.addItems(pending.items);
    if (pending.lines.length > 0) onAddAdvice(pending.lines);
  };

  return (
    <section
      aria-label={t("memory.title", { diagnosis: diagnosisLabel(active.diagnosis) })}
      className="rounded-xl border border-primary/25 bg-primary/[0.03] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-foreground">
            <HistoryIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 break-words">
              {t("memory.title", { diagnosis: diagnosisLabel(active.diagnosis) })}
            </span>
          </p>
          <p className="mt-0.5 pl-6 text-[13px] leading-snug text-muted-foreground">
            {t("memory.basis", { n: active.memory.visits })}
          </p>
        </div>
        <button
          type="button"
          disabled={nothingLeft}
          onClick={(e) => {
            // One gesture adds the lot once: the second click of a double
            // click lands before the rows it added mark the button done
            // (the picker's guard, prescription-columns.ts).
            if (isRepeatClick(e.detail)) return;
            addAll();
          }}
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-4 text-[15px] font-semibold transition-colors",
            nothingLeft
              ? "cursor-default bg-success/10 text-success"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {nothingLeft ? (
            <CheckIcon className="size-4" />
          ) : (
            <ListPlusIcon className="size-4" />
          )}
          {nothingLeft ? t("memory.allAdded") : t("memory.addAll")}
        </button>
      </div>

      {offered.length > 1 && (
        <div
          role="tablist"
          aria-label={t("memory.switch")}
          className="mt-2.5 flex flex-wrap gap-1.5"
        >
          {offered.map((o) => (
            <button
              key={o.key}
              type="button"
              role="tab"
              aria-selected={o.key === active.key}
              onClick={() => setChosen(o.key)}
              title={diagnosisLabel(o.diagnosis)}
              className={cn(
                "inline-flex h-9 max-w-full items-center rounded-lg border px-3 text-sm font-medium transition-colors",
                o.key === active.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              <span className="truncate">
                {o.diagnosis.code ?? o.diagnosis.name}
              </span>
            </button>
          ))}
        </div>
      )}

      <MemoryPrescriptions memory={active.memory} locale={locale} pickApi={pickApi} />

      {active.memory.advice.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("memory.advice")}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {active.memory.advice.map((a) => {
              const added = adviceOnVisit(a.line);
              return (
                <li key={a.line} className="max-w-full">
                  <ChipButton
                    added={added}
                    onClick={() => onAddAdvice([a.line])}
                    title={
                      added
                        ? t("memory.onVisit")
                        : t("memory.usedTimes", { n: a.count })
                    }
                  >
                    <span className="break-words text-foreground">{a.line}</span>
                  </ChipButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** «G43.0 Мигрень без ауры», or whichever half the diagnosis has. */
function diagnosisLabel(d: { code: string | null; name: string | null }): string {
  return formatVisitDiagnosis(d, " ");
}

function MemoryPrescriptions({
  memory,
  locale,
  pickApi,
}: {
  memory: DiagnosisMemory;
  locale: PrescriptionLocale;
  pickApi: PrescriptionPickApi;
}) {
  const t = useTranslations("doctor.reception");
  if (memory.prescriptions.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("memory.prescriptions")}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {memory.prescriptions.map((item) => {
          const added = pickApi.isOnVisit(item);
          const { head, schedule } = memoryChipText(item, locale);
          return (
            <li key={item.key} className="max-w-full">
              <ChipButton
                added={added}
                onClick={() => pickApi.addItem(item)}
                title={
                  added ? t("memory.onVisit") : t("memory.usedTimes", { n: item.count })
                }
              >
                <span className="font-semibold text-foreground">{head}</span>
                {schedule ? (
                  <span className="ml-1.5 text-muted-foreground">{schedule}</span>
                ) : null}
              </ChipButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One suggestion: a big button with a plus, or a check once it is on the visit. */
function ChipButton({
  added,
  onClick,
  title,
  children,
}: {
  added: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={added}
      onClick={(e) => {
        if (isRepeatClick(e.detail)) return;
        onClick();
      }}
      title={title}
      className={cn(
        "inline-flex min-h-11 max-w-full items-start gap-1.5 rounded-lg border px-3 py-2 text-left text-sm leading-snug transition-colors",
        added
          ? "cursor-default border-success/30 bg-success/5 opacity-80"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/5 active:bg-primary/10",
      )}
    >
      {added ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <PlusIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      )}
      <span className="min-w-0">{children}</span>
    </button>
  );
}
