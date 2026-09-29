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
 *
 * «Диагноз» holds one to four diagnoses (clinic request 29.09.2026): the
 * first is the main one, the rest are «сопутствующие» in the doctor's order.
 * Every action sends the whole set, composed on the live cache row (see
 * reception/_hooks/diagnosis-list.ts), so two quick clicks never undo each
 * other.
 *
 * `standalone` is the visit screen, where these two cards own the left
 * column: larger type and controls there. The conclusions screen keeps the
 * compact inset form in its narrow side column.
 */
import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  CheckIcon,
  FileTextIcon,
  HeartPulseIcon,
  HistoryIcon,
  Loader2Icon,
  PenLineIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useRevealOnOpen } from "@/hooks/use-reveal-on-open";
import { parseCodeNameQuery } from "@/lib/icd10-query";
import { visitDiagnosesOf, visitDiagnosisKey } from "@/lib/visit-diagnoses";
import {
  followUpDateBounds,
  followUpDateKey,
  followUpDateProblem,
  followUpDayInstant,
  followUpDue,
  parseFollowUpDays,
  type FollowUpDateProblem,
} from "@/lib/visit-follow-up";

import { useIcd10Search } from "../reception/_hooks/use-icd10";
import {
  useClinicalProtocols,
  type ClinicalProtocolRow,
} from "../reception/_hooks/use-clinical-protocols";
import {
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../reception/_hooks/use-visit-note";
import {
  diagnosisListOf,
  hasDiagnosis,
  MAX_VISIT_DIAGNOSES,
  withDiagnosisMadeMain,
  withDiagnosisPicked,
  withDiagnosisRemoved,
  type DiagnosisItem,
} from "../reception/_hooks/diagnosis-list";
import { useAddChronicCondition } from "../reception/_hooks/use-patient-history";
import { useDoctorFavorites } from "../reception/_hooks/use-doctor-favorites";
import { useDiagnosisShortlist } from "../reception/_hooks/use-shortlists";
import {
  usePatientDiagnoses,
  type PatientDiagnosisRow,
} from "../reception/_hooks/use-patient-diagnoses";

const FOLLOW_UP_PRESETS = [3, 7, 10, 14, 30];

/**
 * Ф6 — «Контрольный визит». The plan is either «через N дней» (a preset or
 * any typed number) or the exact day the doctor names; the server keeps
 * exactly one (src/lib/visit-follow-up.ts). With the note it feeds
 * VisitNote.followUpDays / followUpDate / followUpNote; after finalize the
 * bridge worker turns them into a VISIT_FOLLOW_UP_DUE action for the
 * reception desk.
 */
export function FollowUpCard({
  note,
  disabled,
  onChange,
  standalone,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (patch: VisitNotePatch) => void;
  /** Render as a top-level panel card instead of an inset sub-card. */
  standalone?: boolean;
}) {
  const t = useTranslations("doctor.reception");
  const fmt = useFormatter();
  const big = !!standalone;
  const dateKey = followUpDateKey(note.followUpDate);
  // With an exact day the stored days are only its distance, for older
  // readers: no preset or typed count is the doctor's choice then.
  const days = dateKey ? null : note.followUpDays;
  const presetActive = days != null && FOLLOW_UP_PRESETS.includes(days);
  const customDays = days != null && !presetActive ? days : null;
  const hasPlan = days != null || dateKey != null;
  const due = followUpDue(
    { followUpDays: note.followUpDays, followUpDate: note.followUpDate },
    note.finalizedAt,
  );
  // Per render, not memoised: a visit screen left open past midnight must
  // not keep offering today as «tomorrow».
  const bounds = followUpDateBounds();

  const [noteDraft, setNoteDraft] = React.useState(note.followUpNote ?? "");
  React.useEffect(() => {
    setNoteDraft(note.followUpNote ?? "");
  }, [note.followUpNote]);

  const commitNote = () => {
    const v = noteDraft.trim();
    if (v === (note.followUpNote ?? "")) return;
    onChange({ followUpNote: v || null });
  };

  // «через [N] дн.»: the digits stay local until Enter or leaving the box,
  // so typing «21» never saves «2» on the way.
  const [daysDraft, setDaysDraft] = React.useState(
    customDays != null ? String(customDays) : "",
  );
  const [daysInvalid, setDaysInvalid] = React.useState(false);
  React.useEffect(() => {
    setDaysDraft(customDays != null ? String(customDays) : "");
    setDaysInvalid(false);
  }, [customDays]);

  // The exact day: kept local too. Picked from the calendar it saves at
  // once; typed on the keyboard it saves on Enter or on leaving the box,
  // because the browser reports every keystroke as a whole date (the day
  // «1» of «15» is 1 October, the year «2» is the year 0002).
  const [dateDraft, setDateDraft] = React.useState(dateKey ?? "");
  const [dateProblem, setDateProblem] =
    React.useState<FollowUpDateProblem | null>(null);
  const dateTyping = React.useRef(false);
  React.useEffect(() => {
    setDateDraft(dateKey ?? "");
    setDateProblem(null);
  }, [dateKey]);

  // The blur that follows a save made on Enter or on a pick must not send
  // the same value again. A later blur may: that is the retry after a
  // failed save, whose value is still in the box. Anything else the doctor
  // does in between (a keystroke, a preset, the saved plan changing) ends
  // that pairing.
  const justSent = React.useRef<string | null>(null);
  React.useEffect(() => {
    justSent.current = null;
  }, [days, dateKey]);
  const send = (patch: VisitNotePatch, sig: string, onBlur: boolean) => {
    if (onBlur && justSent.current === sig) {
      justSent.current = null;
      return;
    }
    justSent.current = onBlur ? null : sig;
    onChange(patch);
  };

  const commitDays = (onBlur: boolean) => {
    if (daysDraft.trim() === "") {
      // An emptied box is not «no control visit»: that is the ×.
      setDaysDraft(customDays != null ? String(customDays) : "");
      setDaysInvalid(false);
      return;
    }
    const n = parseFollowUpDays(daysDraft);
    if (n == null) {
      setDaysInvalid(true);
      return;
    }
    setDaysInvalid(false);
    setDateProblem(null);
    if (n !== days) send({ followUpDays: n }, `d${n}`, onBlur);
  };

  /**
   * `typing`: a keystroke, only the box changes. `pick`: chosen in the
   * calendar, or Enter. `settled`: the doctor left the box.
   */
  const commitDate = (value: string, how: "typing" | "pick" | "settled") => {
    setDateDraft(value);
    if (how === "typing") {
      justSent.current = null;
      setDateProblem(null);
      return;
    }
    if (value === "") {
      // Same as the days box: clearing the plan is the ×, not this.
      if (how === "settled") setDateDraft(dateKey ?? "");
      setDateProblem(null);
      return;
    }
    const problem = followUpDateProblem(value);
    if (problem) {
      setDateProblem(problem);
      return;
    }
    setDateProblem(null);
    setDaysInvalid(false);
    if (value !== dateKey) {
      send({ followUpDate: value }, `t${value}`, how === "settled");
    }
  };

  const clearPlan = () => {
    justSent.current = null;
    setDaysInvalid(false);
    setDateProblem(null);
    onChange({ followUpDays: null, followUpDate: null, followUpNote: null });
  };

  const dayLabel = (key: string) =>
    fmt.dateTime(followUpDayInstant(key), {
      day: "numeric",
      month: "long",
      timeZone: "Asia/Tashkent",
    });
  const problemText =
    dateProblem === "past"
      ? t("followUp.datePast", { date: dayLabel(bounds.min) })
      : dateProblem === "too_far"
        ? t("followUp.dateTooFar", { date: dayLabel(bounds.max) })
        : dateProblem === "invalid"
          ? t("followUp.dateInvalid")
          : daysInvalid
            ? t("followUp.daysInvalid")
            : null;

  // Read-only (a signed note past its window): only the choice that holds.
  const showDaysBox = !disabled || customDays != null;
  const showDateBox = !disabled || dateKey != null;
  const activeField = "border-primary/30 bg-primary/10 text-primary";
  const idleField = "border-border bg-card text-foreground";
  const fieldClass = cn(
    "rounded-lg border font-medium tabular-nums transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60",
    big ? "h-10 text-base" : "h-7 text-xs",
  );

  return (
    <div
      className={cn(
        standalone
          ? "rounded-2xl border border-border bg-card p-4"
          : "rounded-xl border border-border bg-background p-3",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-lg bg-muted text-muted-foreground",
              big ? "size-8" : "size-7",
            )}
          >
            <CalendarCheckIcon className="size-4" />
          </span>
          <span
            className={cn(
              "font-semibold text-foreground",
              big ? "text-base" : "text-sm",
            )}
          >
            {t("followUp.title")}
          </span>
        </div>
        {due && (
          <span
            className={cn(
              "font-medium tabular-nums",
              due.exact ? "text-primary" : "text-muted-foreground",
              big ? "text-sm" : "text-[11px]",
            )}
          >
            {/* The weekday helps the doctor steer clear of a Sunday. An
                exact day is the day itself; a count of days is an estimate
                reception books around. */}
            {(() => {
              const label = fmt.dateTime(followUpDayInstant(due.date), {
                weekday: "short",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Tashkent",
              });
              return due.exact ? label : t("followUp.dueOn", { date: label });
            })()}
          </span>
        )}
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center",
          big ? "mt-3 gap-1.5" : "mt-2 gap-1",
        )}
      >
        {FOLLOW_UP_PRESETS.map((d) => {
          const active = days === d;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                justSent.current = null;
                setDaysInvalid(false);
                setDateProblem(null);
                onChange({ followUpDays: active ? null : d });
              }}
              className={cn(
                "inline-flex items-center border font-medium transition-colors disabled:opacity-50",
                big
                  ? "h-9 rounded-lg px-3 text-sm"
                  : "h-6 rounded-md px-1.5 text-[11px]",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
              )}
            >
              {t("followUp.daysShort", { days: d })}
            </button>
          );
        })}
        {hasPlan && !disabled && (
          <button
            type="button"
            aria-label={t("followUp.clear")}
            title={t("followUp.clear")}
            onClick={clearPlan}
            className={cn(
              "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              big ? "size-9" : "size-6",
            )}
          >
            <XIcon className={big ? "size-4" : "size-3"} />
          </button>
        )}
      </div>

      {(showDaysBox || showDateBox) && (
        <div
          className={cn(
            "flex flex-wrap items-center text-muted-foreground",
            big
              ? "mt-2.5 gap-x-4 gap-y-2 text-sm"
              : "mt-1.5 gap-x-3 gap-y-1.5 text-[11px]",
          )}
        >
          {showDaysBox && (
            <label className="inline-flex items-center gap-1.5">
              {t.rich("followUp.customDays", {
                n: () => (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={3}
                    disabled={disabled}
                    value={daysDraft}
                    aria-label={t("followUp.customDaysLabel")}
                    aria-invalid={daysInvalid || undefined}
                    onChange={(e) => {
                      justSent.current = null;
                      setDaysDraft(e.target.value.replace(/\D/g, ""));
                      setDaysInvalid(false);
                    }}
                    onBlur={() => commitDays(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitDays(false);
                      } else if (e.key === "Escape") {
                        setDaysDraft(
                          customDays != null ? String(customDays) : "",
                        );
                        setDaysInvalid(false);
                      }
                    }}
                    className={cn(
                      fieldClass,
                      "text-center",
                      big ? "w-16 px-2" : "w-11 px-1",
                      daysInvalid
                        ? "border-destructive text-destructive"
                        : customDays != null
                          ? activeField
                          : idleField,
                    )}
                  />
                ),
              })}
            </label>
          )}
          {showDateBox && (
            <label className="inline-flex items-center gap-1.5">
              {showDaysBox && <span>{t("followUp.orDate")}</span>}
              <input
                type="date"
                disabled={disabled}
                min={bounds.min}
                max={bounds.max}
                value={dateDraft}
                aria-label={t("followUp.dateLabel")}
                aria-invalid={dateProblem != null || undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    dateTyping.current = false;
                    commitDate(e.currentTarget.value, "pick");
                  } else if (
                    e.key.length === 1 ||
                    e.key === "Backspace" ||
                    e.key === "Delete" ||
                    e.key === "ArrowUp" ||
                    e.key === "ArrowDown"
                  ) {
                    dateTyping.current = true;
                  }
                }}
                onChange={(e) =>
                  commitDate(
                    e.target.value,
                    dateTyping.current ? "typing" : "pick",
                  )
                }
                onBlur={(e) => {
                  dateTyping.current = false;
                  commitDate(e.target.value, "settled");
                }}
                className={cn(
                  fieldClass,
                  big ? "px-2.5" : "px-1.5",
                  dateProblem
                    ? "border-destructive text-destructive"
                    : dateKey != null
                      ? activeField
                      : idleField,
                )}
              />
            </label>
          )}
        </div>
      )}

      {problemText && (
        <p
          role="alert"
          className={cn(
            "font-medium text-destructive",
            big ? "mt-2 text-sm" : "mt-1.5 text-[11px]",
          )}
        >
          {problemText}
        </p>
      )}

      {hasPlan && (
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
          className={cn(
            "w-full rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60",
            big ? "mt-3 h-10 px-3 text-sm" : "mt-2 h-8 px-2.5 text-xs",
          )}
        />
      )}
    </div>
  );
}

/** The small buttons under a diagnosis row, in the two card sizes. */
function rowActionClass(big: boolean, tone: "plain" | "primary"): string {
  return cn(
    "inline-flex items-center gap-1 rounded-md border font-medium transition-colors disabled:opacity-60",
    big ? "h-8 px-2.5 text-xs" : "h-7 px-2 text-[11px]",
    tone === "primary"
      ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
  );
}

export function DiagnosisCard({
  note,
  disabled,
  onChange,
  onRequestApplyProtocol,
  onOpenCatalog,
  standalone,
  saving,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  /**
   * Saves the new diagnosis set: the main one AND the whole list of the
   * others, every time (replace-all).
   */
  onChange: (patch: VisitNotePatch) => void;
  /**
   * Applying a protocol is a visit-time action; a host without it (the
   * correction screen) gets no protocol buttons at all.
   */
  onRequestApplyProtocol?: (protocol: ClinicalProtocolRow) => void;
  /** Opens the ICD catalog drawer; hosts without one just omit it. */
  onOpenCatalog?: () => void;
  /** Render as a top-level panel card instead of an inset sub-card. */
  standalone?: boolean;
  /** Shared save-in-flight flag for the header spinner (standalone hosts). */
  saving?: boolean;
}) {
  const t = useTranslations("doctor.reception");
  const qc = useQueryClient();
  const big = !!standalone;

  const list = React.useMemo(
    () =>
      diagnosisListOf({
        diagnosisCode: note.diagnosisCode,
        diagnosisName: note.diagnosisName,
        additionalDiagnoses: note.additionalDiagnoses,
      }),
    [note.diagnosisCode, note.diagnosisName, note.additionalDiagnoses],
  );
  const onVisit = React.useMemo(
    () =>
      new Set(
        list
          .map((d) => visitDiagnosisKey(d))
          .filter((k): k is string => k !== null),
      ),
    [list],
  );
  const full = list.length >= MAX_VISIT_DIAGNOSES;

  // «+ Диагноз» opens a second search under the list; the next patient's
  // note starts with it closed.
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => {
    setAdding(false);
  }, [note.id]);

  // Kept observed while the card is on screen, so the list that opens on a
  // tap of «+ Диагноз» is already there.
  useDiagnosisShortlist(!disabled);
  // Protocols follow the main diagnosis only: a standard is written for
  // what the visit is about, not for a comorbidity.
  const protocolsQuery = useClinicalProtocols(
    onRequestApplyProtocol ? note.diagnosisCode : null,
  );
  const protocols = protocolsQuery.data ?? [];

  // Ф7 — «в хронические»: один клик копирует диагноз в карточку пациента.
  // Per diagnosis: a comorbidity (hypertension next to a migraine) is the
  // one most often chronic.
  const chronic = useAddChronicCondition(note.patientId);
  const [chronicSaved, setChronicSaved] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  React.useEffect(() => {
    setChronicSaved(new Set());
  }, [note.id]);

  const handleToChronic = (d: DiagnosisItem) => {
    const name = d.name ?? d.code;
    const key = visitDiagnosisKey(d);
    if (!name || !key) return;
    chronic.mutate(
      {
        name,
        notes: d.code ? `МКБ-10: ${d.code}` : null,
      },
      {
        onSuccess: () => {
          setChronicSaved((prev) => new Set(prev).add(key));
          toast.success(t("diagnosis.toChronicDone"));
        },
        onError: () => toast.error(t("diagnosis.toChronicError")),
      },
    );
  };

  /** The note as the doctor last left it (see diagnosis-list.ts). */
  const liveNote = React.useCallback(
    (): VisitNoteRow =>
      qc.getQueryData<VisitNoteRow>(visitNoteKey(note.id)) ?? note,
    [qc, note],
  );

  const pick = (code: string | null, name: string | null) => {
    const live = liveNote();
    const next = withDiagnosisPicked(live, { code, name });
    if (!next) {
      if (hasDiagnosis(live, { code, name })) {
        toast.info(t("diagnosis.alreadyAdded"));
      }
      return;
    }
    onChange(next);
    setAdding(false);
  };

  const remove = (d: DiagnosisItem) => {
    const next = withDiagnosisRemoved(liveNote(), d);
    if (next) onChange(next);
  };

  const makeMain = (d: DiagnosisItem) => {
    const next = withDiagnosisMadeMain(liveNote(), d);
    if (next) onChange(next);
  };

  const showSearch = !disabled && (list.length === 0 || adding);

  return (
    <div
      className={cn(
        standalone
          ? "rounded-2xl border border-border bg-card p-4"
          : "rounded-xl border border-border bg-background p-3",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-lg bg-muted text-muted-foreground",
              big ? "size-8" : "size-7",
            )}
          >
            <FileTextIcon className="size-4" />
          </span>
          <span
            className={cn(
              "font-semibold text-foreground",
              big ? "text-base" : "text-sm",
            )}
          >
            {t("diagnosis.title")}
          </span>
          {/* A filled diagnosis is confirmed with a check; an empty one is
              simply empty — it stopped being mandatory (23.09.2026), so a
              red «обязательно» badge would now be a lie. */}
          {standalone && list.length > 0 ? (
            <span className="inline-flex size-4.5 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckIcon className="size-3" />
            </span>
          ) : null}
          {saving && (
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>
        {onOpenCatalog && !disabled && !full && (
          <button
            type="button"
            onClick={onOpenCatalog}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border bg-card font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
              big ? "h-8 px-2.5 text-xs" : "h-7 px-2 text-[11px]",
            )}
          >
            <BookOpenIcon className={big ? "size-3.5" : "size-3"} />
            {t("diagnosis.catalogButton")}
          </button>
        )}
      </div>

      <div className={cn("flex flex-col", big ? "mt-3 gap-2.5" : "mt-2.5 gap-2")}>
        {list.length > 0 && (
          <ul className="flex flex-col gap-2">
            {list.map((d, i) => {
              const main = i === 0;
              const key = visitDiagnosisKey(d) ?? `row-${i}`;
              return (
                <DiagnosisRow
                  key={key}
                  diagnosis={d}
                  main={main}
                  big={big}
                  disabled={disabled}
                  onRemove={() => remove(d)}
                >
                  {!disabled && (
                    <>
                      {main &&
                        onRequestApplyProtocol &&
                        protocols.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onRequestApplyProtocol(p)}
                            title={p.summaryRu ?? t("diagnosis.applyProtocolTitle")}
                            className={rowActionClass(big, "primary")}
                          >
                            <WandSparklesIcon className="size-3" />
                            {t("diagnosis.applyStandard")}
                            <span className="rounded-md bg-primary/15 px-1 font-mono text-[10px]">
                              {p.diagnosisCodePrefix}
                            </span>
                          </button>
                        ))}
                      {!main && (
                        <button
                          type="button"
                          onClick={() => makeMain(d)}
                          className={rowActionClass(big, "plain")}
                        >
                          <ArrowUpIcon className="size-3" />
                          {t("diagnosis.makeMain")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={chronic.isPending || chronicSaved.has(key)}
                        onClick={() => handleToChronic(d)}
                        title={t("diagnosis.toChronicTitle")}
                        className={rowActionClass(big, "plain")}
                      >
                        {chronic.isPending &&
                        chronic.variables?.name === (d.name ?? d.code) ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <HeartPulseIcon className="size-3" />
                        )}
                        {chronicSaved.has(key)
                          ? t("diagnosis.toChronicDone")
                          : t("diagnosis.toChronic")}
                      </button>
                    </>
                  )}
                </DiagnosisRow>
              );
            })}
          </ul>
        )}

        {showSearch && (
          <DiagnosisSearch
            big={big}
            // Opened by «+ Диагноз»: the doctor already asked for it, so
            // the caret and the list of his frequent ones are there at once.
            autoFocus={list.length > 0}
            placeholder={
              list.length === 0
                ? t("diagnosis.searchPlaceholderTap")
                : t("diagnosis.addPlaceholder")
            }
            exclude={onVisit}
            onPick={pick}
            onCancel={list.length > 0 ? () => setAdding(false) : undefined}
          />
        )}

        {/* The doctor's first complaint about this screen was "нигде не
            указано" — the field looked like a search box with no hint that
            typing your own wording is allowed. */}
        {!disabled && list.length === 0 && (
          <p
            className={cn(
              "leading-snug text-muted-foreground",
              big ? "text-xs" : "text-[11px]",
            )}
          >
            {t("diagnosis.hint")}
          </p>
        )}

        {!disabled && list.length > 0 && !adding && (
          full ? (
            <p
              className={cn(
                "leading-snug text-muted-foreground",
                big ? "text-xs" : "text-[11px]",
              )}
            >
              {t("diagnosis.full", { max: MAX_VISIT_DIAGNOSES })}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              title={t("diagnosis.addTitle", { max: MAX_VISIT_DIAGNOSES })}
              className={cn(
                "inline-flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                big ? "h-10 px-3 text-sm" : "h-8 px-2.5 text-xs",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <PlusIcon className={big ? "size-4" : "size-3.5"} />
                {t("diagnosis.add")}
              </span>
              <span className="text-xs font-normal tabular-nums">
                {t("diagnosis.count", {
                  n: list.length,
                  max: MAX_VISIT_DIAGNOSES,
                })}
              </span>
            </button>
          )
        )}

        {disabled && list.length === 0 && (
          <p className="text-sm text-muted-foreground">—</p>
        )}

        <PastDiagnosesBlock
          note={note}
          onVisit={onVisit}
          canTake={!disabled && !full}
          onTake={pick}
        />
      </div>
    </div>
  );
}

/** One diagnosis of the visit: its role, the code and the words. */
function DiagnosisRow({
  diagnosis,
  main,
  big,
  disabled,
  onRemove,
  children,
}: {
  diagnosis: DiagnosisItem;
  main: boolean;
  big: boolean;
  disabled: boolean;
  onRemove: () => void;
  /** The row's actions (protocols, «сделать основным», «в хронические»). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("doctor.reception");
  const { code, name } = diagnosis;
  // A code stored without words shows once, not as «G43.0 G43.0».
  const words = name && name !== code ? name : null;
  return (
    <li
      className={cn(
        "rounded-xl border",
        big ? "px-3 py-2.5" : "px-2.5 py-2",
        main ? "border-primary/30 bg-primary/5" : "border-border bg-background",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block font-semibold uppercase tracking-wide",
              big ? "text-[11px]" : "text-[10px]",
              main ? "text-primary" : "text-muted-foreground",
            )}
          >
            {main ? t("diagnosis.main") : t("diagnosis.additional")}
          </span>
          <p
            className={cn(
              "mt-0.5 break-words leading-snug",
              big ? "text-[15px]" : "text-sm",
            )}
          >
            {code && (
              <span className="mr-2 font-mono font-semibold text-primary">
                {code}
              </span>
            )}
            {words && <span className="text-foreground">{words}</span>}
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            aria-label={t("diagnosis.remove")}
            title={t("diagnosis.remove")}
            onClick={onRemove}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive",
              big ? "size-8" : "size-6",
            )}
          >
            <XIcon className={big ? "size-4" : "size-3.5"} />
          </button>
        )}
      </div>
      {children ? (
        <div className={cn("flex flex-wrap gap-1.5", big ? "mt-2" : "mt-1.5")}>
          {children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The diagnosis search: tap for the doctor's frequent ones, type for ICD-10,
 * the clinic's learned wordings, «код + название» or his own words. The same
 * field picks the main diagnosis and, behind «+ Диагноз», each further one.
 */
function DiagnosisSearch({
  big,
  autoFocus,
  placeholder,
  exclude,
  onPick,
  onCancel,
}: {
  big: boolean;
  autoFocus: boolean;
  placeholder: string;
  /** Keys of the diagnoses already on the visit: not offered again. */
  exclude: ReadonlySet<string>;
  onPick: (code: string | null, name: string | null) => void;
  /** Closes the field (the «+ Диагноз» one); absent for the main search. */
  onCancel?: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const hits = useIcd10Search(query);
  const { pinned, toggle } = useDoctorFavorites("ICD10");
  // What opens on a tap with nothing typed: his starred and most-written
  // diagnoses. The rest of ICD-10 stays behind search (clinic request
  // 25.09.2026 — one doctor lives on migraine, another on lumbago).
  const shortlist = useDiagnosisShortlist(true);
  const shortRows = (shortlist.data ?? []).filter((r) => {
    const key = visitDiagnosisKey(r);
    return !key || !exclude.has(key);
  });
  const shortOpen = focused && query.trim().length < 2 && shortRows.length > 0;
  const hitsOpen = focused && query.trim().length >= 2;
  const shortListRef = useRevealOnOpen<HTMLDivElement>(shortOpen);
  const hitsListRef = useRevealOnOpen<HTMLUListElement>(hitsOpen);
  const rows = hits.data ?? [];

  const choose = (code: string | null, name: string | null) => {
    onPick(code, name);
    setQuery("");
    setFocused(false);
  };

  const itemClass = cn(
    "flex w-full items-start gap-2 px-3 text-left transition-colors hover:bg-muted",
    big ? "py-2 text-[15px]" : "py-1.5 text-sm",
  );

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(true);
          }}
          // A pick keeps the caret in the field (mousedown is prevented),
          // so a second tap fires no focus event: reopen on click too.
          onClick={() => setFocused(true)}
          onFocus={() => {
            setFocused(true);
            if (shortlist.isStale) void shortlist.refetch();
          }}
          onBlur={() =>
            setTimeout(() => {
              setFocused(false);
              // Walking away from an empty «+ Диагноз» field closes it; a
              // half-typed one stays, the words are the doctor's.
              if (onCancel && !inputRef.current?.value.trim()) onCancel();
            }, 150)
          }
          onKeyDown={(e) => {
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              onCancel();
            }
          }}
          className={cn(
            "w-full rounded-lg border border-border bg-card pl-9 pr-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            big ? "h-10 text-[15px]" : "h-9 text-sm",
          )}
        />
        {/* Same layering as the prescription picker: above the sticky
            action bar and scrolled clear of it. */}
        {shortOpen && (
          <div
            ref={shortListRef}
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 scroll-mb-28 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md"
          >
            <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("diagnosis.shortMine")}
            </p>
            <ul>
              {shortRows.map((r) => (
                <li key={`${r.code ?? ""}|${r.name}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(r.code, r.name);
                    }}
                    className={itemClass}
                  >
                    {r.code ? (
                      <span className="font-mono font-semibold text-primary">
                        {r.code}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 text-foreground">
                      {r.name}
                    </span>
                    {r.count > 0 ? (
                      <span
                        title={t("diagnosis.shortCount", { n: r.count })}
                        className="mt-0.5 shrink-0 rounded bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground"
                      >
                        {r.count}
                      </span>
                    ) : null}
                    {r.code ? (
                      <span
                        role="button"
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          // Star, don't pick: keep the list open.
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(r.code!);
                        }}
                        title={
                          pinned.has(r.code)
                            ? t("diagnosis.favRemove")
                            : t("diagnosis.favAdd")
                        }
                        className={cn(
                          "shrink-0 rounded p-0.5 transition-colors",
                          pinned.has(r.code)
                            ? "text-amber-500"
                            : "text-muted-foreground/40 hover:text-amber-500",
                        )}
                      >
                        <StarIcon
                          className={cn(
                            "size-3.5",
                            pinned.has(r.code) ? "fill-amber-400" : "",
                          )}
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {hitsOpen && (
          <ul
            ref={hitsListRef}
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 scroll-mb-28 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md"
          >
            {rows.map((r) => (
              // A learned wording without a code has code "": several of
              // them would share a key (audit CT-05).
              <li key={`${r.code}|${r.nameRu}`}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r.code || null, r.nameRu);
                  }}
                  className={itemClass}
                >
                  {r.code ? (
                    <span className="font-mono font-semibold text-primary">
                      {r.code}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 text-foreground">
                    {r.nameRu}
                  </span>
                  {/* Learned from THIS clinic's signed conclusions — worth
                      knowing it's a colleague's wording, not the classifier. */}
                  {r.custom ? (
                    <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      {t("diagnosis.clinicBadge")}
                    </span>
                  ) : null}
                  {r.code ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        // Star, don't pick: keep the dropdown open.
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(r.code);
                      }}
                      title={
                        pinned.has(r.code)
                          ? t("diagnosis.favRemove")
                          : t("diagnosis.favAdd")
                      }
                      className={cn(
                        "shrink-0 rounded p-0.5 transition-colors",
                        pinned.has(r.code)
                          ? "text-amber-500"
                          : "text-muted-foreground/40 hover:text-amber-500",
                      )}
                    >
                      <StarIcon
                        className={cn(
                          "size-3.5",
                          pinned.has(r.code) ? "fill-amber-400" : "",
                        )}
                      />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {/* Free text is a first-class option: the reference doesn't cover
                every wording a doctor uses, and hunting for a code mid-visit
                is exactly the friction that made this screen feel unusable.
                The code is for statistics; the name makes the document valid. */}
            {(() => {
              const pair = parseCodeNameQuery(query);
              if (!pair) return null;
              return (
                <li className={rows.length > 0 ? "border-t border-border/60" : ""}>
                  {/* The catalog lacks some codes the doctor knows by heart.
                      «G43.81 Название» becomes one click: code AND name land
                      together, and signing will teach it to the clinic
                      catalog for everyone. */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(pair.code, pair.name);
                    }}
                    className={cn(itemClass, "items-center")}
                  >
                    <span className="font-mono font-semibold text-primary">
                      {pair.code}
                    </span>
                    <span className="text-foreground">{pair.name}</span>
                  </button>
                </li>
              );
            })()}
            {query.trim().length >= 2 && (
              <li className={rows.length > 0 ? "border-t border-border/60" : ""}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(null, query.trim());
                  }}
                  className={cn(itemClass, "items-center")}
                >
                  <PenLineIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-foreground">
                    {t("diagnosis.useAsTyped", { text: query.trim() })}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("diagnosis.cancelAdd")}
          title={t("diagnosis.cancelAdd")}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            big ? "size-10" : "size-9",
          )}
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

/** How many past visits fit before the panel starts feeling like a list. */
const PAST_DIAGNOSES_VISIBLE = 3;

/**
 * «Было раньше» — the patient's earlier ICD-10 diagnoses, right under the
 * search box.
 *
 * A repeat patient starts every visit on a blank note, and the diagnosis
 * history lives on another tab — so the doctor had to leave the consultation
 * screen to remember what they treated last time. Showing it here closes that
 * loop, and «взять» copies one into the current visit: as the main one while
 * the visit has none, as one more after that.
 *
 * Deliberately never auto-fills: a diagnosis is the doctor's assertion, and a
 * prefilled one is easy to sign without reading. The click is the consent.
 */
function PastDiagnosesBlock({
  note,
  onVisit,
  canTake,
  onTake,
}: {
  note: VisitNoteRow;
  /** Keys of the diagnoses already on this visit: nothing to take there. */
  onVisit: ReadonlySet<string>;
  /** False while the visit is finalized or already holds four. */
  canTake: boolean;
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
            onVisit={onVisit}
            canTake={canTake}
            dateLabel={formatter.dateTime(new Date(d.date), {
              day: "2-digit",
              month: "2-digit",
            })}
            onTake={onTake}
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

/**
 * One earlier visit: each of its diagnoses on its own line with its own
 * «взять», since that visit may have had up to four.
 */
function PastDiagnosisRow({
  row,
  onVisit,
  canTake,
  dateLabel,
  onTake,
  takeLabel,
}: {
  row: PatientDiagnosisRow;
  onVisit: ReadonlySet<string>;
  canTake: boolean;
  dateLabel: string;
  onTake: (code: string | null, name: string | null) => void;
  takeLabel: string;
}) {
  const diagnoses = visitDiagnosesOf(row);
  return (
    <li className="rounded-md px-1 py-1 transition-colors hover:bg-background">
      <ul className="flex flex-col gap-0.5">
        {diagnoses.map((d, i) => {
          const key = visitDiagnosisKey(d);
          return (
            <li key={key ?? i} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                {d.code && (
                  <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
                    {d.code}
                  </span>
                )}
                {d.name && d.name !== d.code && (
                  <span className="truncate text-xs text-foreground/80">
                    {d.name}
                  </span>
                )}
              </div>
              {/* Hidden while the visit is finalized or full (nothing to
                  write into) and while this one is already on the visit
                  (nothing to change). */}
              {canTake && key && !onVisit.has(key) && (
                <button
                  type="button"
                  onClick={() => onTake(d.code, d.name)}
                  // Always visible, not hover-revealed: clinics use touch
                  // screens, and a button that needs a mouse hover simply
                  // doesn't exist there.
                  className="motion-press mt-0.5 shrink-0 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {takeLabel}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="truncate text-[11px] text-muted-foreground tabular-nums">
        {dateLabel} · {row.doctorName}
      </div>
    </li>
  );
}
