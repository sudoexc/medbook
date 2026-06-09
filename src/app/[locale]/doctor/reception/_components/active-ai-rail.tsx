"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FilePlus2Icon,
  HelpCircleIcon,
  InfoIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  useBuildConclusion,
  useClarifyingQuestions,
  useIcd10Suggest,
  useReceptionWarnings,
  type ReceptionWarning,
} from "../_hooks/use-reception-ai";
import { usePatchVisitNote, useVisitNote } from "../_hooks/use-visit-note";

type WarningTone = ReceptionWarning["tone"];
type DiagnosisHintTone = "likely" | "possible";

export function ActiveAIRail() {
  const t = useTranslations("doctor.reception");
  const { activeAppointment, visitNoteId, bumpBodyInject } = useReceptionContext();
  const note = useVisitNote(visitNoteId).data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const patientId = activeAppointment?.patient.id ?? null;

  // Summary — backed by the existing patient-summary cache endpoint.
  const summary = useQuery<{ text: string; pendingRefresh: boolean }>({
    queryKey: ["doctor", "reception", "ai-summary", patientId],
    enabled: !!patientId,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${patientId}/summary?locale=ru`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`summary ${res.status}`);
      return (await res.json()) as { text: string; pendingRefresh: boolean };
    },
    staleTime: 60_000,
  });

  const clarifying = useClarifyingQuestions();
  const icd10 = useIcd10Suggest();
  const builder = useBuildConclusion();
  const warnings = useReceptionWarnings(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);

  const hasNote = !!visitNoteId;

  const onAskClarifying = () => {
    if (!visitNoteId) return;
    clarifying.mutate({ noteId: visitNoteId });
  };

  const onSuggestIcd10 = () => {
    if (!visitNoteId) return;
    icd10.mutate({ noteId: visitNoteId });
  };

  const onPickIcd10 = async (s: { code: string; nameRu: string }) => {
    if (!visitNoteId || isFinalized) return;
    try {
      await patch.mutateAsync({
        diagnosisCode: s.code,
        diagnosisName: s.nameRu,
      });
    } catch {
      // toast handled by global error boundary in app shell
    }
  };

  const onBuildConclusion = async () => {
    if (!visitNoteId || isFinalized) return;
    try {
      const result = await builder.mutateAsync({ noteId: visitNoteId });
      if (!result.markdown) return;
      await patch.mutateAsync({ bodyMarkdown: result.markdown });
      bumpBodyInject();
    } catch {
      // ignore — fallback path renders even on LLM failure
    }
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col gap-4 xl:gap-5">
      <Section
        icon={SparklesIcon}
        title={t("aiRail.assistantTitle")}
        accent="primary"
        actionDisabled={!patientId}
      >
        {!patientId ? (
          <p className="text-sm text-muted-foreground">{t("aiRail.selectActivePatient")}</p>
        ) : summary.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : summary.data?.text ? (
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
            {summary.data.text}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("aiRail.summaryUnavailable")}</p>
        )}
      </Section>

      <Section
        icon={HelpCircleIcon}
        title={t("aiRail.clarifyingTitle")}
        onAction={hasNote ? onAskClarifying : undefined}
        actionLabel={clarifying.data ? t("aiRail.refresh") : t("aiRail.generate")}
        actionBusy={clarifying.isPending}
        actionDisabled={!hasNote}
      >
        {!hasNote ? (
          <p className="text-sm text-muted-foreground">{t("aiRail.startVisitHint")}</p>
        ) : !clarifying.data ? (
          <p className="text-xs text-muted-foreground">
            {t("aiRail.clarifyingHint")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {clarifying.data.questions.map((q, i) => (
              <li key={i}>
                <div className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="flex-1">{q}</span>
                </div>
              </li>
            ))}
            {clarifying.data.fromFallback && (
              <li className="text-[11px] text-muted-foreground">{t("aiRail.clarifyingFallback")}</li>
            )}
          </ul>
        )}
      </Section>

      <Section
        icon={FilePlus2Icon}
        title={t("aiRail.icd10Title")}
        onAction={hasNote ? onSuggestIcd10 : undefined}
        actionLabel={icd10.data ? t("aiRail.refresh") : t("aiRail.generate")}
        actionBusy={icd10.isPending}
        actionDisabled={!hasNote}
      >
        {!hasNote ? (
          <p className="text-sm text-muted-foreground">{t("aiRail.startVisitHint")}</p>
        ) : !icd10.data ? (
          <p className="text-xs text-muted-foreground">
            {t("aiRail.icd10Hint")}
          </p>
        ) : icd10.data.suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("aiRail.icd10NoData")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {icd10.data.suggestions.map((h) => (
              <li
                key={h.code}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {h.code}
                    </span>
                    <ToneBadge tone={h.tone} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-foreground">
                    {h.nameRu}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onPickIcd10(h)}
                  disabled={isFinalized || patch.isPending}
                  className="inline-flex h-7 shrink-0 items-center rounded-md bg-primary/10 px-2 text-xs font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
                  title={t("aiRail.applyDiagnosis")}
                >
                  +
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={AlertTriangleIcon} title={t("aiRail.warningsTitle")}>
        {!hasNote ? (
          <p className="text-sm text-muted-foreground">{t("aiRail.warningsStartHint")}</p>
        ) : warnings.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (warnings.data?.warnings ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("aiRail.warningsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {warnings.data!.warnings.map((w) => (
              <WarningRow key={w.id} tone={w.tone} text={w.text} />
            ))}
          </ul>
        )}
      </Section>

      <button
        type="button"
        onClick={onBuildConclusion}
        disabled={!hasNote || isFinalized || builder.isPending || patch.isPending}
        className="motion-press inline-flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        <div className="inline-flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            {builder.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-4" />
            )}
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {t("aiRail.smartBuilderTitle")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("aiRail.smartBuilderSubtitle")}
            </div>
          </div>
        </div>
        <ChevronRightIcon className="size-4 text-primary" />
      </button>
    </aside>
  );
}

function Section({
  icon: Icon,
  title,
  accent,
  onAction,
  actionLabel,
  actionBusy,
  actionDisabled,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  accent?: "primary";
  onAction?: () => void;
  actionLabel?: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("doctor.reception");
  return (
    <section
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4",
        accent === "primary" && "border-primary/20 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5">
          {Icon && (
            <Icon
              className={cn(
                "size-4",
                accent === "primary" ? "text-primary" : "text-muted-foreground",
              )}
            />
          )}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled || actionBusy}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            {actionBusy ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            {actionLabel ?? t("aiRail.refresh")}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function ToneBadge({ tone }: { tone: DiagnosisHintTone }) {
  const t = useTranslations("doctor.reception");
  if (tone === "likely") {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-success/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-success">
        {t("aiRail.toneLikely")}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {t("aiRail.tonePossible")}
    </span>
  );
}

function WarningRow({ tone, text }: { tone: WarningTone; text: string }) {
  const map: Record<
    WarningTone,
    { Icon: LucideIcon; bg: string; fg: string }
  > = {
    info: { Icon: InfoIcon, bg: "bg-info/10", fg: "text-info" },
    warn: {
      Icon: AlertTriangleIcon,
      bg: "bg-warning/10",
      fg: "text-warning",
    },
    alert: {
      Icon: CircleAlertIcon,
      bg: "bg-destructive/10",
      fg: "text-destructive",
    },
  };
  const { Icon, bg, fg } = map[tone];
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2",
      )}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
          bg,
          fg,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="flex-1 text-xs text-foreground">{text}</span>
    </li>
  );
}
