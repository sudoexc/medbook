"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  HeartPulseIcon,
  ListChecksIcon,
  NotebookPenIcon,
  PlusIcon,
  UtensilsIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  handoutSectionTitle,
  type HandoutGuideSection,
  type HandoutLocale,
} from "@/lib/catalogs/handout-composer";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  pickGuideText,
  useDiagnosisGuide,
  type DiagnosisGuideRow,
} from "../_hooks/use-diagnosis-guide";
import type { VisitNoteRow } from "../_hooks/use-visit-note";

type SectionDef = {
  key: HandoutGuideSection;
  labelKey: string;
  Icon: LucideIcon;
  accent?: "danger";
};

const SECTIONS: SectionDef[] = [
  { key: "whatToDo", labelKey: "guide.sections.whatToDo", Icon: ListChecksIcon },
  { key: "care", labelKey: "guide.sections.care", Icon: HeartPulseIcon },
  { key: "lifestyle", labelKey: "guide.sections.lifestyle", Icon: UtensilsIcon },
  {
    key: "redFlags",
    labelKey: "guide.sections.redFlags",
    Icon: AlertTriangleIcon,
    accent: "danger",
  },
];

function sectionText(
  guide: DiagnosisGuideRow,
  key: HandoutGuideSection,
  locale: string,
): string | null {
  switch (key) {
    case "whatToDo":
      return pickGuideText(locale, guide.whatToDoRu, guide.whatToDoUz);
    case "care":
      return pickGuideText(locale, guide.careRu, guide.careUz);
    case "lifestyle":
      return pickGuideText(locale, guide.lifestyleRu, guide.lifestyleUz);
    case "redFlags":
      return pickGuideText(locale, guide.redFlagsRu, guide.redFlagsUz);
  }
}

/**
 * «База знаний» (Ф1) — shows the matched DiagnosisGuide under the diagnosis
 * picker: accordion sections with per-section «В памятку», advice chips that
 * merge into the structured advice field, and «Вставить всё».
 */
export function DiagnosisGuideCard({
  note,
  disabled,
  onMergeAdvice,
  onSetFollowUpDays,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onMergeAdvice: (chips: string[]) => void;
  onSetFollowUpDays: (days: number) => void;
}) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: HandoutLocale = rawLocale === "uz" ? "uz" : "ru";
  const { requestHandoutAppend } = useReceptionContext();
  const guideQuery = useDiagnosisGuide(note.diagnosisCode);
  const guide = guideQuery.data?.[0] ?? null;

  const [open, setOpen] = React.useState<Record<string, boolean>>({
    whatToDo: true,
  });

  if (!note.diagnosisCode) return null;

  // Нет гайда под код — не исчезаем молча, а говорим, где его завести.
  if (!guide) {
    if (disabled || guideQuery.isPending) return null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2">
        <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("guide.empty", { code: note.diagnosisCode })}
        </p>
      </div>
    );
  }

  const title =
    locale === "uz" ? guide.titleUz?.trim() || guide.titleRu : guide.titleRu;

  const sections = SECTIONS.map((def) => ({
    def,
    text: sectionText(guide, def.key, locale),
  })).filter((s): s is { def: SectionDef; text: string } => !!s.text);

  const advice = note.advice ?? [];
  const newChips = guide.adviceChips.filter((c) => !advice.includes(c));

  const insertSection = (def: SectionDef, text: string) => {
    requestHandoutAppend(`${handoutSectionTitle(locale, def.key)}\n${text}`);
  };

  const defaultFollowUpDays = guide.defaultFollowUpDays;

  const insertAll = () => {
    if (newChips.length > 0) onMergeAdvice(newChips);
    if (sections.length > 0) {
      requestHandoutAppend(
        sections
          .map((s) => `${handoutSectionTitle(locale, s.def.key)}\n${s.text}`)
          .join("\n\n"),
      );
    }
    // Ф6 — prefill the control visit unless the doctor already set one.
    if (defaultFollowUpDays != null && note.followUpDays == null) {
      onSetFollowUpDays(defaultFollowUpDays);
    }
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpenIcon className="size-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/70">
              {t("guide.title")}
            </span>
            <span className="text-sm font-semibold text-foreground">{title}</span>
          </div>
        </div>
        {!disabled && (sections.length > 0 || newChips.length > 0) && (
          <button
            type="button"
            onClick={insertAll}
            title={t("guide.insertAllTitle")}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <WandSparklesIcon className="size-3" />
            {t("guide.insertAll")}
          </button>
        )}
      </div>

      {!disabled && newChips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("guide.chipsTitle")}
          </span>
          {newChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onMergeAdvice([chip])}
              title={t("guide.chipTitle")}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <PlusIcon className="size-2.5" />
              {chip}
            </button>
          ))}
        </div>
      )}

      {sections.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {sections.map(({ def, text }) => {
            const isOpen = !!open[def.key];
            const Icon = def.Icon;
            return (
              <div
                key={def.key}
                className={cn(
                  "rounded-lg border bg-card",
                  def.accent === "danger"
                    ? "border-destructive/30"
                    : "border-border",
                )}
              >
                <div className="flex items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((o) => ({ ...o, [def.key]: !o[def.key] }))
                    }
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                  >
                    <Icon
                      className={cn(
                        "size-3 shrink-0",
                        def.accent === "danger"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "truncate text-xs font-semibold",
                        def.accent === "danger"
                          ? "text-destructive"
                          : "text-foreground",
                      )}
                    >
                      {t(def.labelKey)}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => insertSection(def, text)}
                      title={t("guide.insertTitle")}
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                    >
                      <NotebookPenIcon className="size-3" />
                      {t("guide.insert")}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <p className="whitespace-pre-line border-t border-border/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                    {text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {defaultFollowUpDays != null && (
        <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarClockIcon className="size-3" />
          {t("guide.followUpHint", { days: defaultFollowUpDays })}
          {!disabled && note.followUpDays !== defaultFollowUpDays && (
            <button
              type="button"
              onClick={() => onSetFollowUpDays(defaultFollowUpDays)}
              className="inline-flex h-5 items-center rounded-md border border-primary/30 bg-primary/5 px-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {t("guide.followUpApply")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
