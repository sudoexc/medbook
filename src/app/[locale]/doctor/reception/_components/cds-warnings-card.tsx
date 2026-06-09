"use client";

/**
 * Phase G4 — CDS warnings panel.
 *
 * Renders the warnings returned by `useCdsDrugCheck`, grouped by severity
 * and colour-coded. Sits between the prescriptions chip field and the next
 * structured field so the doctor sees red bars the moment a risky combo
 * lands in the basket.
 *
 * Phase G8 — each warning row gets a "Я учёл" affordance that opens a
 * reason picker and POSTs a CdsOverride row. Once an override is recorded
 * (or persisted to localStorage as already-acknowledged this session) the
 * row collapses to a muted bar so the doctor can scan past it.
 */
import * as React from "react";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  BabyIcon,
  CheckCircle2Icon,
  HeartPulseIcon,
  InfoIcon,
  LayersIcon,
  Loader2Icon,
  ShieldAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  useCdsDrugCheck,
  type CdsSeverity,
  type CdsWarning,
  type CdsWarningKind,
} from "../_hooks/use-cds-drug-check";
import {
  OVERRIDE_REASON_LABELS,
  useCreateCdsOverride,
  type CdsOverrideReason,
} from "../_hooks/use-cds-overrides";

const SEVERITY_STYLES: Record<
  CdsSeverity,
  { wrap: string; chip: string; label: string }
> = {
  CONTRAINDICATED: {
    wrap: "border-destructive/40 bg-destructive/10",
    chip: "bg-destructive/15 text-destructive",
    label: "Противопоказано",
  },
  MAJOR: {
    wrap: "border-destructive/30 bg-destructive/5",
    chip: "bg-destructive/10 text-destructive",
    label: "Высокий риск",
  },
  MODERATE: {
    wrap: "border-warning/40 bg-warning/10",
    chip: "bg-warning/20 text-[color:var(--warning)]",
    label: "Внимание",
  },
  MINOR: {
    wrap: "border-info/30 bg-info/10",
    chip: "bg-info/15 text-[color:var(--info)]",
    label: "Информация",
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
  diagnosisCode: string | null;
  // G8 — contextual ids forwarded to the override mutation. Optional so the
  // card still renders in the future patient drawer (no active visit there).
  appointmentId?: string | null;
  visitNoteId?: string | null;
};

function warningKey(w: CdsWarning): string {
  // Stable identity for collapsing duplicate renders + dedupe storage.
  return `${w.kind}:${w.severity}:${w.title}`;
}

export function CdsWarningsCard({
  patientId,
  prescriptions,
  diagnosisCode,
  appointmentId,
  visitNoteId,
}: Props) {
  const query = useCdsDrugCheck({ patientId, prescriptions, diagnosisCode });
  const [acknowledged, setAcknowledged] = React.useState<Set<string>>(
    () => new Set(),
  );
  const handleAcknowledged = React.useCallback((key: string) => {
    setAcknowledged((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  if (!patientId || prescriptions.length === 0) return null;

  const result = query.data;
  const showSpinner = query.isFetching && !result;

  if (showSpinner) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        Проверка взаимодействий и аллергий…
      </div>
    );
  }

  if (!result) return null;

  // Nothing resolved → silent. We don't claim "all clear" when we never
  // matched any drug from the chips (manually typed lines may slip through).
  if (result.resolvedDrugs.length === 0) return null;

  if (result.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-[11px] text-[color:var(--success)]">
        <AlertOctagonIcon className="size-3 rotate-180" />
        Конфликтов и аллергий не выявлено
        {result.resolvedDrugs.length > 0 && (
          <span className="text-[color:var(--success)]/70">
            ({result.resolvedDrugs.length} назначений распознано)
          </span>
        )}
        {result.unresolvedLines.length > 0 && (
          <span className="ml-auto text-[color:var(--success)]/60">
            {result.unresolvedLines.length} строк без сопоставления
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
        <ShieldAlertIcon className="size-3 text-destructive" />
        Предупреждения CDS
        <span className="rounded-md bg-destructive/15 px-1 text-[10px] font-semibold text-destructive">
          {result.warnings.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {result.warnings.map((w) => {
          const key = warningKey(w);
          return (
            <WarningRow
              key={key}
              warning={w}
              warningKey={key}
              patientId={patientId}
              appointmentId={appointmentId ?? null}
              visitNoteId={visitNoteId ?? null}
              acknowledged={acknowledged.has(key)}
              onAcknowledged={() => handleAcknowledged(key)}
            />
          );
        })}
      </ul>
      {result.unresolvedLines.length > 0 && (
        <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <InfoIcon className="size-2.5" />
          {result.unresolvedLines.length} строк{" "}
          {result.unresolvedLines.length === 1 ? "не распознана" : "не распознаны"} —
          CDS пропустил их (введите через каталог).
        </p>
      )}
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
          override записан
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
              {style.label}
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
            Я учёл
          </Button>
        )}
      </div>
      {picking && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/80 bg-background/70 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Причина override
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
                {OVERRIDE_REASON_LABELS[r]}
              </button>
            ))}
          </div>
          <input
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder={
              noteRequired ? "комментарий (обязательно)" : "комментарий (необязательно)"
            }
            aria-invalid={noteMissing}
            className={cn(
              "h-7 rounded-md border bg-background px-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/30",
              noteMissing ? "border-destructive" : "border-border",
            )}
          />
          {create.isError && (
            <p className="text-[10px] text-destructive">
              Не удалось сохранить: {(create.error as Error)?.message ?? "ошибка"}
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
              Отмена
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
              Сохранить
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
