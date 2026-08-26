"use client";

/**
 * Shared clinical cards: «Диагноз» (ICD-10) and «Контрольный визит».
 *
 * Extracted verbatim from the reception `structured-fields-panel` so the
 * conclusions screen can offer the SAME controls while the 24h post-finalize
 * edit window is open. A second implementation was the alternative and it is
 * the worse one: two diagnosis/follow-up UIs inevitably drift, and a doctor
 * correcting a finalized note must not meet a subtly different control than
 * the one they used during the visit.
 *
 * Both cards are pure prop-driven components — they never touch the reception
 * context — so a host screen only supplies `note`, `disabled` and callbacks.
 */
import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  CalendarCheckIcon,
  FileTextIcon,
  HeartPulseIcon,
  HistoryIcon,
  Loader2Icon,
  SearchIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { useIcd10Search } from "../reception/_hooks/use-icd10";
import {
  useClinicalProtocols,
  type ClinicalProtocolRow,
} from "../reception/_hooks/use-clinical-protocols";
import type {
  VisitNotePatch,
  VisitNoteRow,
} from "../reception/_hooks/use-visit-note";
import { useAddChronicCondition } from "../reception/_hooks/use-patient-history";
import {
  usePatientDiagnoses,
  type PatientDiagnosisRow,
} from "../reception/_hooks/use-patient-diagnoses";

const FOLLOW_UP_PRESETS = [3, 7, 10, 14, 30];

/**
 * Ф6 — «Контрольный визит». Days + note feed VisitNote.followUpDays /
 * followUpNote; after finalize the bridge worker turns them into a
 * VISIT_FOLLOW_UP_DUE action for the reception desk.
 */
export function FollowUpCard({
  note,
  disabled,
  onChange,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (patch: VisitNotePatch) => void;
}) {
  const t = useTranslations("doctor.reception");
  const fmt = useFormatter();
  const days = note.followUpDays;
  const [noteDraft, setNoteDraft] = React.useState(note.followUpNote ?? "");

  React.useEffect(() => {
    setNoteDraft(note.followUpNote ?? "");
  }, [note.followUpNote]);

  const commitNote = () => {
    const v = noteDraft.trim();
    if (v === (note.followUpNote ?? "")) return;
    onChange({ followUpNote: v || null });
  };

  const due =
    days != null && days > 0
      ? new Date(Date.now() + days * 86_400_000)
      : null;

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarCheckIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {t("followUp.title")}
          </span>
        </div>
        {due && (
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {t("followUp.dueOn", {
              date: fmt.dateTime(due, { day: "numeric", month: "long" }),
            })}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {FOLLOW_UP_PRESETS.map((d) => {
          const active = days === d;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ followUpDays: active ? null : d })}
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
              )}
            >
              {t("followUp.daysShort", { days: d })}
            </button>
          );
        })}
        {days != null && !FOLLOW_UP_PRESETS.includes(days) && (
          <span className="inline-flex h-6 items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
            {t("followUp.daysShort", { days })}
          </span>
        )}
        {days != null && !disabled && (
          <button
            type="button"
            aria-label={t("followUp.clear")}
            onClick={() => onChange({ followUpDays: null, followUpNote: null })}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {days != null && (
        <input
          type="text"
          disabled={disabled}
          value={noteDraft}
          maxLength={500}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNote();
            }
          }}
          placeholder={t("followUp.notePlaceholder")}
          className="mt-2 h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />
      )}
    </div>
  );
}

export function DiagnosisCard({
  note,
  disabled,
  onChange,
  onRequestApplyProtocol,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (code: string | null, name: string | null) => void;
  onRequestApplyProtocol: (protocol: ClinicalProtocolRow) => void;
}) {
  const t = useTranslations("doctor.reception");
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const hits = useIcd10Search(query);
  const protocolsQuery = useClinicalProtocols(note.diagnosisCode);
  const protocols = protocolsQuery.data ?? [];
  // Ф7 — «в хронические»: один клик копирует диагноз в карточку пациента.
  const chronic = useAddChronicCondition(note.patientId);
  const [chronicSaved, setChronicSaved] = React.useState(false);
  React.useEffect(() => {
    setChronicSaved(false);
  }, [note.diagnosisCode]);

  const handleToChronic = () => {
    const name = note.diagnosisName ?? note.diagnosisCode;
    if (!name) return;
    chronic.mutate(
      {
        name,
        notes: note.diagnosisCode ? `МКБ-10: ${note.diagnosisCode}` : null,
      },
      {
        onSuccess: () => {
          setChronicSaved(true);
          toast.success(t("diagnosis.toChronicDone"));
        },
        onError: () => toast.error(t("diagnosis.toChronicError")),
      },
    );
  };

  const rows = hits.data ?? [];

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileTextIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">{t("diagnosis.title")}</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            disabled={disabled}
            placeholder={t("diagnosis.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          {focused && rows.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
              {rows.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(r.code, r.nameRu);
                      setQuery("");
                      setFocused(false);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="font-mono font-semibold text-primary">
                      {r.code}
                    </span>
                    <span className="text-foreground">{r.nameRu}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <PastDiagnosesBlock note={note} disabled={disabled} onTake={onChange} />
        {note.diagnosisCode && note.diagnosisName && (
          <>
            <div className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-sm">
              <span className="font-mono font-semibold text-primary">
                {note.diagnosisCode}
              </span>
              <span className="text-foreground">{note.diagnosisName}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={t("diagnosis.reset")}
                  onClick={() => onChange(null, null)}
                  className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
            {!disabled && (
              <div className="flex flex-wrap gap-1.5">
                {protocols.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onRequestApplyProtocol(p)}
                    title={p.summaryRu ?? t("diagnosis.applyProtocolTitle")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <WandSparklesIcon className="size-3" />
                    {t("diagnosis.applyStandard")}
                    <span className="rounded-md bg-primary/15 px-1 font-mono text-[10px]">
                      {p.diagnosisCodePrefix}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={chronic.isPending || chronicSaved}
                  onClick={handleToChronic}
                  title={t("diagnosis.toChronicTitle")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-60"
                >
                  {chronic.isPending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <HeartPulseIcon className="size-3" />
                  )}
                  {chronicSaved
                    ? t("diagnosis.toChronicDone")
                    : t("diagnosis.toChronic")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** How many past diagnoses fit before the panel starts feeling like a list. */
const PAST_DIAGNOSES_VISIBLE = 3;

/**
 * «Было раньше» — the patient's earlier ICD-10 diagnoses, right under the
 * search box.
 *
 * A repeat patient starts every visit on a blank note, and the diagnosis
 * history lives on another tab — so the doctor had to leave the consultation
 * screen to remember what they treated last time. Showing it here closes that
 * loop, and «взять» copies one into the current visit.
 *
 * Deliberately never auto-fills: a diagnosis is the doctor's assertion, and a
 * prefilled one is easy to sign without reading. The click is the consent.
 */
function PastDiagnosesBlock({
  note,
  disabled,
  onTake,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onTake: (code: string | null, name: string | null) => void;
}) {
  const t = useTranslations("doctor.reception");
  const formatter = useFormatter();
  const [expanded, setExpanded] = React.useState(false);
  const query = usePatientDiagnoses(note.patientId);

  // Drop this visit's own row — the endpoint returns finalized notes, so a
  // re-opened visit would otherwise offer the doctor their own diagnosis back.
  const rows = React.useMemo(
    () => (query.data ?? []).filter((d) => d.visitNoteId !== note.id),
    [query.data, note.id],
  );

  if (rows.length === 0) return null;

  const shown = expanded ? rows : rows.slice(0, PAST_DIAGNOSES_VISIBLE);
  const hidden = rows.length - shown.length;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-2">
      <div className="mb-1.5 inline-flex items-center gap-1.5 px-0.5">
        <HistoryIcon className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("diagnosis.pastTitle")}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {shown.map((d) => (
          <PastDiagnosisRow
            key={d.visitNoteId}
            row={d}
            disabled={disabled}
            isCurrent={d.diagnosisCode === note.diagnosisCode}
            dateLabel={formatter.dateTime(new Date(d.date), {
              day: "2-digit",
              month: "2-digit",
            })}
            onTake={() => onTake(d.diagnosisCode, d.diagnosisName)}
            takeLabel={t("diagnosis.pastTake")}
          />
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/5"
        >
          {t("diagnosis.pastMore", { count: hidden })}
        </button>
      )}
    </div>
  );
}

function PastDiagnosisRow({
  row,
  disabled,
  isCurrent,
  dateLabel,
  onTake,
  takeLabel,
}: {
  row: PatientDiagnosisRow;
  disabled: boolean;
  isCurrent: boolean;
  dateLabel: string;
  onTake: () => void;
  takeLabel: string;
}) {
  return (
    <li className="group flex items-start gap-2 rounded-md px-1 py-1 transition-colors hover:bg-background">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
            {row.diagnosisCode}
          </span>
          {row.diagnosisName && (
            <span className="truncate text-xs text-foreground/80">
              {row.diagnosisName}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground tabular-nums">
          {dateLabel} · {row.doctorName}
        </div>
      </div>
      {/* Hidden while the visit is finalized (nothing to write into) and while
          this code is already the current diagnosis (nothing to change). */}
      {!disabled && !isCurrent && (
        <button
          type="button"
          onClick={onTake}
          // Always visible, not hover-revealed: clinics use touch screens, and
          // a button that needs a mouse hover simply doesn't exist there.
          className="motion-press mt-0.5 shrink-0 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {takeLabel}
        </button>
      )}
    </li>
  );
}
