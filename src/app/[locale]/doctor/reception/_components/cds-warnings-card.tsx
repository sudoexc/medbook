"use client";

/**
 * Phase G4 — CDS warnings panel.
 *
 * Renders the warnings returned by `useCdsDrugCheck`, grouped by severity
 * and colour-coded. Sits inside the «Назначения» card, under the rows, so
 * the doctor sees red bars the moment a risky combo lands in the basket.
 *
 * Phase G8 — each warning row gets a "Я учёл" affordance that opens a
 * reason picker and POSTs a CdsOverride row. Once an override is recorded
 * the row collapses to a muted bar so the doctor can scan past it. The
 * overrides already recorded on the visit note are read back from the
 * server (audit VW-25), so the bar stays muted after a tab switch or a
 * reload and the doctor is not asked to justify the same warning twice.
 * Signing does not wait on them: whether it should is the doctor's call.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  BabyIcon,
  CheckCircle2Icon,
  HeartPulseIcon,
  InfoIcon,
  LayersIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { allergySuggestionNames } from "@/lib/catalogs/drug-names";
import { cdsWarningKey } from "@/lib/cds-warning-key";
import { cn } from "@/lib/utils";

import {
  useCdsDrugCheck,
  type CdsCurrentTherapyDrug,
  type CdsDrugRow,
  type CdsResolvedDrug,
  type CdsSeverity,
  type CdsVisitDiagnosis,
  type CdsWarning,
  type CdsWarningKind,
} from "../_hooks/use-cds-drug-check";
import {
  useAcknowledgedCdsWarnings,
  useCreateCdsOverride,
  type CdsOverrideReason,
} from "../_hooks/use-cds-overrides";
import {
  useRecordAllergy,
  type AllergySeverity,
} from "../_hooks/use-patient-history";

const SEVERITY_STYLES: Record<
  CdsSeverity,
  { wrap: string; chip: string; labelKey: string }
> = {
  CONTRAINDICATED: {
    wrap: "border-destructive/40 bg-destructive/10",
    chip: "bg-destructive/15 text-destructive",
    labelKey: "cds.severity.contraindicated",
  },
  MAJOR: {
    wrap: "border-destructive/30 bg-destructive/5",
    chip: "bg-destructive/10 text-destructive",
    labelKey: "cds.severity.major",
  },
  MODERATE: {
    wrap: "border-warning/40 bg-warning/10",
    chip: "bg-warning/20 text-[color:var(--warning)]",
    labelKey: "cds.severity.moderate",
  },
  MINOR: {
    wrap: "border-info/30 bg-info/10",
    chip: "bg-info/15 text-[color:var(--info)]",
    labelKey: "cds.severity.minor",
  },
};

const KIND_ICONS: Record<CdsWarningKind, React.ComponentType<{ className?: string }>> = {
  ALLERGY: ShieldAlertIcon,
  INTERACTION: AlertTriangleIcon,
  DUPLICATE_CLASS: LayersIcon,
  PREGNANCY: BabyIcon,
  DIAGNOSIS_RISK: HeartPulseIcon,
};

type Props = {
  patientId: string | null;
  prescriptions: string[];
  /** Ф2 — catalog-picked structured rows, by id with their labels. */
  drugRows?: CdsDrugRow[];
  diagnosisCode: string | null;
  /** Every diagnosis of the visit, main first; each is checked. */
  diagnoses?: CdsVisitDiagnosis[];
  // G8 — contextual ids forwarded to the override mutation. Optional so the
  // card still renders in the future patient drawer (no active visit there).
  appointmentId?: string | null;
  visitNoteId?: string | null;
};

function warningKey(w: CdsWarning): string {
  // Per warning AND per drug (audit G4-05): each one is acknowledged on its
  // own. See cds-warning-key.ts.
  return cdsWarningKey(w);
}

/** The warnings one answer of the check showed, for one visit. */
export type ShownWarnings = {
  noteId: string | null | undefined;
  keys: ReadonlySet<string>;
};

/**
 * Whether an answer brings a warning worth scrolling to: one the previous
 * answer for the same visit did not show, not acknowledged already. The
 * visit's first answer (`before` null, or another visit's) is no news: the
 * warnings it holds were there when the doctor opened the visit.
 */
export function bringsNewWarning(
  before: ShownWarnings | null,
  now: ShownWarnings,
  isAcknowledged: (key: string) => boolean,
): boolean {
  if (!before || before.noteId !== now.noteId) return false;
  for (const key of now.keys) {
    if (!before.keys.has(key) && !isAcknowledged(key)) return true;
  }
  return false;
}

export function CdsWarningsCard({
  patientId,
  prescriptions,
  drugRows = [],
  diagnosisCode,
  diagnoses,
  appointmentId,
  visitNoteId,
}: Props) {
  const t = useTranslations("doctor.reception");
  const query = useCdsDrugCheck({
    patientId,
    prescriptions,
    drugRows,
    diagnosisCode,
    diagnoses,
    visitNoteId,
  });
  // Acknowledged just now on this screen, on top of what the visit's
  // recorded overrides say (read back, VW-25).
  const [acknowledged, setAcknowledged] = React.useState<Set<string>>(
    () => new Set(),
  );
  const recorded = useAcknowledgedCdsWarnings(visitNoteId);
  const isAcknowledged = (key: string) =>
    acknowledged.has(key) || (recorded.data?.has(key) ?? false);
  const handleAcknowledged = React.useCallback((key: string) => {
    setAcknowledged((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  // A warning that appears while the doctor prescribes is brought into view
  // (review of 03.10.2026). The card sits under the rows, which sit under
  // the picker's columns: a drug clicked in «Частые» on a laptop put its
  // interaction or allergy warning below the fold or under the sticky
  // «Завершить приём» bar, where it could be missed before signing. Only a
  // warning new since the last answer moves the page: what the visit held
  // when it opened is no news, nor is one already acknowledged.
  const revealRef = React.useRef<HTMLDivElement>(null);
  const shownRef = React.useRef<ShownWarnings | null>(null);
  const checking = !!patientId && (prescriptions.length > 0 || drugRows.length > 0);
  const answer = query.data;
  const recordedKeys = recorded.data;
  React.useEffect(() => {
    // Waiting for the first answer about these drugs: nothing to compare.
    if (checking && !answer) return;
    const now = {
      noteId: visitNoteId,
      keys: new Set(checking && answer ? answer.warnings.map(warningKey) : []),
    };
    const before = shownRef.current;
    shownRef.current = now;
    const news = bringsNewWarning(
      before,
      now,
      (k) => acknowledged.has(k) || (recordedKeys?.has(k) ?? false),
    );
    if (!news) return;
    // After paint, so the card has its final height.
    requestAnimationFrame(() => {
      revealRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [checking, answer, visitNoteId, acknowledged, recordedKeys]);

  if (!patientId || (prescriptions.length === 0 && drugRows.length === 0)) {
    return null;
  }

  const result = query.data;
  const showSpinner = query.isFetching && !result && !query.isError;

  // VW-13 — the check failed (a 500, a timeout, a 403 after a role change, no
  // network). Said out loud with a retry, never a silent card: silence is
  // what a drug outside the catalog looks like, and an allergy would then go
  // unnoticed. A failed refetch hides the older answer too: it was computed
  // before whatever made the check stale (an allergy just recorded).
  if (query.isError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-text"
      >
        <AlertTriangleIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1">{t("cds.unavailable")}</span>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-background px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {query.isFetching ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : null}
          {t("cds.retry")}
        </button>
      </div>
    );
  }

  if (showSpinner) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        {t("cds.checking")}
      </div>
    );
  }

  if (!result) return null;

  // Nothing resolved → silent. We don't claim "all clear" when we never
  // matched any drug from the chips (manually typed lines may slip through).
  if (result.resolvedDrugs.length === 0) return null;

  // Drugs the interaction base knows nothing about. «Конфликтов не найдено»
  // would be a false all-clear for them (audit G4-01), so the card names
  // them instead and never shows the green bar while any are left.
  const noDataNames = result.resolvedDrugs
    .filter((d) => (result.noInteractionData ?? []).includes(d.id))
    .map((d) => d.nameRu);
  // Same honesty for pregnancy (audit G4-13): a drug with no known category
  // was not checked, so the patient who may be pregnant gets no green bar.
  const noPregnancyNames = result.resolvedDrugs
    .filter((d) => (result.noPregnancyData ?? []).includes(d.id))
    .map((d) => d.nameRu);
  // What the patient already takes and the new drugs were checked against
  // (audit G4-03): said out loud, so a green bar is known to include it.
  const currentTherapy = result.currentTherapy ?? [];
  const therapyNote =
    currentTherapy.length > 0 ? (
      <CurrentTherapyNote drugs={currentTherapy} />
    ) : null;

  if (
    result.warnings.length === 0 &&
    (noDataNames.length > 0 || noPregnancyNames.length > 0)
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        {noDataNames.length > 0 && <NoInteractionDataNote names={noDataNames} />}
        {noPregnancyNames.length > 0 && (
          <NoPregnancyDataNote names={noPregnancyNames} />
        )}
        {therapyNote}
        {result.unresolvedLines.length > 0 && (
          <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <InfoIcon className="size-2.5" />
            {t("cds.unresolvedNote", { count: result.unresolvedLines.length })}
          </p>
        )}
        <AllergyQuickRecord
          patientId={patientId}
          suggestions={result.resolvedDrugs}
        />
      </div>
    );
  }

  if (result.warnings.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-[11px] text-[color:var(--success)]">
          <AlertOctagonIcon className="size-3 rotate-180" />
          {t("cds.noConflicts")}
          {result.resolvedDrugs.length > 0 && (
            <span className="text-[color:var(--success)]/70">
              {t("cds.recognizedCount", { count: result.resolvedDrugs.length })}
            </span>
          )}
          {result.unresolvedLines.length > 0 && (
            <span className="ml-auto text-[color:var(--success)]/60">
              {t("cds.unmatchedCount", { count: result.unresolvedLines.length })}
            </span>
          )}
        </div>
        {therapyNote}
        <AllergyQuickRecord
          patientId={patientId}
          suggestions={result.resolvedDrugs}
        />
      </div>
    );
  }

  return (
    // scroll-mb: revealed clear of the sticky «Завершить приём» bar.
    <div ref={revealRef} className="flex scroll-mb-28 flex-col gap-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
        <ShieldAlertIcon className="size-3 text-destructive" />
        {t("cds.warningsTitle")}
        <span className="rounded-md bg-destructive/15 px-1 text-[10px] font-semibold text-destructive">
          {result.warnings.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {result.warnings.map((w, i) => {
          const key = warningKey(w);
          return (
            <WarningRow
              // The same allergy recorded twice gives two equal warnings:
              // one acknowledgement covers both, but React needs two keys.
              key={`${key}#${i}`}
              warning={w}
              warningKey={key}
              patientId={patientId}
              appointmentId={appointmentId ?? null}
              visitNoteId={visitNoteId ?? null}
              acknowledged={isAcknowledged(key)}
              onAcknowledged={() => handleAcknowledged(key)}
            />
          );
        })}
      </ul>
      {noDataNames.length > 0 && <NoInteractionDataNote names={noDataNames} />}
      {noPregnancyNames.length > 0 && (
        <NoPregnancyDataNote names={noPregnancyNames} />
      )}
      {therapyNote}
      {result.unresolvedLines.length > 0 && (
        <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <InfoIcon className="size-2.5" />
          {t("cds.unresolvedNote", { count: result.unresolvedLines.length })}
        </p>
      )}
      <AllergyQuickRecord
        patientId={patientId}
        suggestions={result.resolvedDrugs}
      />
    </div>
  );
}

/**
 * The patient's current therapy the check took into account: running
 * courses and what the patient listed in the questionnaire. Neutral, like
 * the «нет данных» lines: it informs, it does not warn.
 */
function CurrentTherapyNote({ drugs }: { drugs: CdsCurrentTherapyDrug[] }) {
  const t = useTranslations("doctor.reception");
  const names = drugs
    .map((d) =>
      d.source === "PATIENT_REPORTED"
        ? t("cds.currentTherapyReported", { name: d.nameRu })
        : d.nameRu,
    )
    .join(", ");
  return (
    <p className="inline-flex items-start gap-1 text-[10px] text-muted-foreground">
      <PillIcon className="mt-0.5 size-2.5 shrink-0" />
      <span>{t("cds.currentTherapy", { names })}</span>
    </p>
  );
}

/**
 * Honest «we don't know» line for drugs outside the interaction base. Neutral
 * (not green, not red): the check did not find a problem because it had
 * nothing to check against.
 */
function NoInteractionDataNote({ names }: { names: string[] }) {
  const t = useTranslations("doctor.reception");
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <InfoIcon className="mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium text-foreground">
          {t("cds.noInteractionData", { names: names.join(", ") })}
        </span>{" "}
        {t("cds.noInteractionDataHint")}
      </span>
    </div>
  );
}

/**
 * Neutral line for drugs whose pregnancy category nobody knows: the check
 * found no problem only because it had nothing to check against.
 */
function NoPregnancyDataNote({ names }: { names: string[] }) {
  const t = useTranslations("doctor.reception");
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <BabyIcon className="mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium text-foreground">
          {t("cds.noPregnancyData", { names: names.join(", ") })}
        </span>{" "}
        {t("cds.noPregnancyDataHint")}
      </span>
    </div>
  );
}

const ALLERGY_SEVERITIES: AllergySeverity[] = ["MILD", "MODERATE", "SEVERE"];

/**
 * Ф7 — «записать аллергию» в один клик. Новая PatientAllergy сразу
 * инвалидирует CDS-проверку, так что конфликт подсветится без перезагрузки.
 */
function AllergyQuickRecord({
  patientId,
  suggestions,
}: {
  patientId: string | null;
  suggestions: CdsResolvedDrug[];
}) {
  const t = useTranslations("doctor.reception");
  const [open, setOpen] = React.useState(false);
  const [substance, setSubstance] = React.useState("");
  const [severity, setSeverity] = React.useState<AllergySeverity>("MODERATE");
  const record = useRecordAllergy(patientId);

  // The drugs' Russian names, never their `inn` column (audit G4-19): that
  // holds handles like «uzr:karbaleks» or «aspirin_cardio», and a click wrote
  // them into the patient's record, the print and the reception's view.
  const nameSuggestions = React.useMemo(
    () => allergySuggestionNames(suggestions),
    [suggestions],
  );

  if (!patientId) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 w-fit items-center gap-1 rounded-md border border-dashed border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <PlusIcon className="size-2.5" />
        {t("cds.recordAllergy")}
      </button>
    );
  }

  const reset = () => {
    setOpen(false);
    setSubstance("");
    setSeverity("MODERATE");
  };

  const submit = () => {
    const v = substance.trim();
    if (!v || record.isPending) return;
    record.mutate(
      { substance: v, severity },
      {
        onSuccess: () => {
          toast.success(t("cds.allergySaved", { substance: v }));
          reset();
        },
        onError: () => toast.error(t("cds.errorFallback")),
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/80 bg-background/70 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("cds.recordAllergy")}
      </div>
      <input
        value={substance}
        autoFocus
        onChange={(e) => setSubstance(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            reset();
          }
        }}
        placeholder={t("cds.allergySubstancePlaceholder")}
        className="h-7 rounded-md border border-border bg-background px-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {nameSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nameSuggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSubstance(name)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                substance === name
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/60",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {ALLERGY_SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
              severity === s
                ? s === "SEVERE"
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted/60",
            )}
          >
            {t(`cds.allergySeverity.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={reset}
          disabled={record.isPending}
        >
          {t("cds.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={submit}
          disabled={!substance.trim() || record.isPending}
        >
          {record.isPending && (
            <Loader2Icon className="mr-1 size-3 animate-spin" />
          )}
          {t("cds.save")}
        </Button>
      </div>
    </div>
  );
}

type WarningRowProps = {
  warning: CdsWarning;
  warningKey: string;
  patientId: string | null;
  appointmentId: string | null;
  visitNoteId: string | null;
  acknowledged: boolean;
  onAcknowledged: () => void;
};

function WarningRow({
  warning,
  warningKey,
  patientId,
  appointmentId,
  visitNoteId,
  acknowledged,
  onAcknowledged,
}: WarningRowProps) {
  const t = useTranslations("doctor.reception");
  const style = SEVERITY_STYLES[warning.severity];
  const Icon = KIND_ICONS[warning.kind];
  const [picking, setPicking] = React.useState(false);
  const [reason, setReason] = React.useState<CdsOverrideReason | "">("");
  const [reasonNote, setReasonNote] = React.useState("");
  const create = useCreateCdsOverride();

  const noteRequired = reason === "OTHER";
  const noteMissing = noteRequired && !reasonNote.trim();

  const submit = () => {
    if (!patientId || !reason || noteMissing) return;
    create.mutate(
      {
        patientId,
        appointmentId,
        visitNoteId,
        warningKind: warning.kind,
        severity: warning.severity,
        warningTitle: warning.title,
        warningDetail: warning.detail,
        warningKey,
        reason,
        reasonNote: reasonNote.trim() || null,
      },
      {
        onSuccess: () => {
          setPicking(false);
          onAcknowledged();
        },
      },
    );
  };

  if (acknowledged) {
    return (
      <li
        className={cn(
          "flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]",
          "border-muted bg-muted/30 text-muted-foreground",
        )}
      >
        <CheckCircle2Icon className="size-3 text-[color:var(--success)]" />
        <span className="line-through">{warning.title}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide">
          {t("cds.overrideRecorded")}
        </span>
      </li>
    );
  }

  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md border px-2 py-1.5", style.wrap)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wide",
                style.chip,
              )}
            >
              {t(style.labelKey)}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {warning.title}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-foreground/80">{warning.detail}</p>
        </div>
        {patientId && !picking && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] font-semibold"
            onClick={() => setPicking(true)}
          >
            {t("cds.acknowledge")}
          </Button>
        )}
      </div>
      {picking && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/80 bg-background/70 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("cds.overrideReason")}
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                "CLINICALLY_JUSTIFIED",
                "PATIENT_INFORMED",
                "ALTERNATIVES_TRIED",
                "FALSE_POSITIVE",
                "OTHER",
              ] as const
            ).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  reason === r
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted/60 text-muted-foreground",
                )}
              >
                {t(`cds.reasons.${r}`)}
              </button>
            ))}
          </div>
          <input
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder={
              noteRequired
                ? t("cds.commentRequired")
                : t("cds.commentOptional")
            }
            aria-invalid={noteMissing}
            className={cn(
              "h-7 rounded-md border bg-background px-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/30",
              noteMissing ? "border-destructive" : "border-border",
            )}
          />
          {create.isError && (
            <p className="text-[10px] text-destructive">
              {t("cds.saveError", {
                message: (create.error as Error)?.message ?? t("cds.errorFallback"),
              })}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setPicking(false);
                setReason("");
                setReasonNote("");
              }}
              disabled={create.isPending}
            >
              {t("cds.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={submit}
              disabled={!reason || noteMissing || create.isPending}
            >
              {create.isPending && (
                <Loader2Icon className="mr-1 size-3 animate-spin" />
              )}
              {t("cds.save")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
