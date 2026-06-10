"use client";

/**
 * Ф2 (TZ-smart-constructor) — structured prescription constructor.
 *
 * Replaces the free-text chip input for the prescriptions field. Doctor
 * searches the DB drug catalog (brand/INN/ATC, top-12), picking a drug
 * auto-fills form/strength from Drug.forms and the how-to-take text from
 * Drug.defaultDosing.adult; the schedule (times of day, meal relation,
 * duration) is set with segment controls. «Свой препарат» adds a free-text
 * row (name + dose) that gets the same schedule controls.
 *
 * Persistence is replace-all via PATCH {visitPrescriptions: [...]} — the
 * same autosave model as the chip fields. Legacy text lines
 * (note.prescriptions — old notes, protocol templates, presets) render
 * below the structured rows and stay removable.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BellIcon,
  BellOffIcon,
  BookOpenIcon,
  ChevronDownIcon,
  PillIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatPrescriptionLine,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";

import type { DoctorPresetRow } from "../_hooks/use-doctor-presets";
import {
  useDrugSearch,
  useDrugSuggestions,
  type DrugSearchHit,
} from "../_hooks/use-drug-search";
import type {
  VisitNoteRow,
  VisitPrescriptionDraft,
  VisitPrescriptionMealRelation,
  VisitPrescriptionRow,
  VisitPrescriptionTimeOfDay,
} from "../_hooks/use-visit-note";

const TIMES: VisitPrescriptionTimeOfDay[] = [
  "MORNING",
  "NOON",
  "EVENING",
  "NIGHT",
];

const MEALS: VisitPrescriptionMealRelation[] = [
  "BEFORE_MEAL",
  "WITH_MEAL",
  "AFTER_MEAL",
  "EMPTY_STOMACH",
  "NO_MATTER",
];

const DURATION_PICKS = [5, 7, 10, 14, 30];

/** Build a structured row draft from a catalog drug (search hit or drawer pick). */
export function draftFromDrug(
  d: Pick<DrugSearchHit, "id" | "nameRu" | "forms" | "defaultDosing">,
): VisitPrescriptionDraft {
  const firstForm = d.forms?.[0] ?? null;
  const strength = firstForm?.strengths?.[0] ?? null;
  return {
    drugId: d.id,
    displayName: d.nameRu,
    form: firstForm?.form ?? null,
    strength,
    dose: strength ?? "1",
    timesOfDay: [],
    mealRelation: "NO_MATTER",
    durationDays: null,
    instructionRu: d.defaultDosing?.adult?.trim() || null,
    instructionUz: null,
    remindPatient: true,
  };
}

function toDrafts(rows: VisitPrescriptionRow[]): VisitPrescriptionDraft[] {
  return rows.map(
    ({ id: _id, sortOrder: _sortOrder, ...rest }) => rest,
  );
}

type Props = {
  note: VisitNoteRow;
  disabled: boolean;
  presets: DoctorPresetRow[];
  onSaveRows: (rows: VisitPrescriptionDraft[]) => void;
  onPresetClick: (preset: DoctorPresetRow) => void;
  onRemoveLegacyChip: (chip: string) => void;
  onOpenCatalog: () => void;
};

export function PrescriptionConstructor({
  note,
  disabled,
  presets,
  onSaveRows,
  onPresetClick,
  onRemoveLegacyChip,
  onOpenCatalog,
}: Props) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";

  const rows = React.useMemo(
    () => note.visitPrescriptions ?? [],
    [note.visitPrescriptions],
  );
  const legacy = note.prescriptions ?? [];

  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);

  const searchQuery = useDrugSearch(query);
  const suggestQuery = useDrugSuggestions(note.diagnosisCode);

  const addedDrugIds = React.useMemo(
    () => new Set(rows.map((r) => r.drugId).filter(Boolean) as string[]),
    [rows],
  );
  const suggestions = (suggestQuery.data ?? []).filter(
    (d) => !addedDrugIds.has(d.id),
  );
  const hits = searchQuery.data ?? [];

  const addDraft = React.useCallback(
    (draft: VisitPrescriptionDraft) => {
      onSaveRows([...toDrafts(rows), draft]);
      setExpanded(rows.length);
    },
    [rows, onSaveRows],
  );

  const addFromDrug = React.useCallback(
    (d: DrugSearchHit) => {
      addDraft(draftFromDrug(d));
      setQuery("");
      setFocused(false);
    },
    [addDraft],
  );

  const updateRow = React.useCallback(
    (index: number, patch: Partial<VisitPrescriptionDraft>) => {
      const drafts = toDrafts(rows);
      const current = drafts[index];
      if (!current) return;
      drafts[index] = { ...current, ...patch };
      onSaveRows(drafts);
    },
    [rows, onSaveRows],
  );

  const removeRow = React.useCallback(
    (index: number) => {
      const drafts = toDrafts(rows);
      drafts.splice(index, 1);
      onSaveRows(drafts);
      setExpanded(null);
    },
    [rows, onSaveRows],
  );

  const availablePresets = presets.filter((p) => !legacy.includes(p.fieldValue));

  return (
    <div className="rounded-xl border border-border bg-background px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PillIcon className="size-3" />
          </span>
          <span className="text-xs font-semibold text-foreground">
            {t("fields.prescriptions.label")}
          </span>
          {rows.length + legacy.length > 0 && (
            <span className="rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {rows.length + legacy.length}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenCatalog}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
            title={t("structured.catalogTitle")}
          >
            <BookOpenIcon className="size-3" />
            {t("structured.catalog")}
          </button>
          <button
            type="button"
            disabled={disabled || customOpen}
            onClick={() => setCustomOpen(true)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            <PlusIcon className="size-3" />
            {t("rx.custom")}
          </button>
        </div>
      </div>

      {/* ── Catalog search ── */}
      {!disabled && (
        <div className="relative mt-1.5">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={t("rx.searchPlaceholder")}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {focused && query.trim().length >= 2 && hits.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
              {hits.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addFromDrug(d);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-medium text-foreground">
                          {d.nameRu}
                        </span>
                        {d.forms?.[0]?.strengths?.[0] && (
                          <span className="text-xs text-muted-foreground">
                            {d.forms[0].strengths.join(" / ")}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {d.inn}
                        {d.brands.length > 0
                          ? ` · ${d.brands.map((b) => b.name).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    {d.rxOnly && (
                      <span className="mt-0.5 shrink-0 rounded-md bg-blue-100 px-1 text-[9px] font-semibold uppercase text-blue-800">
                        Rx
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── «Часто назначают при …» ── */}
      {!disabled && note.diagnosisCode && suggestions.length > 0 && (
        <div className="mt-1.5">
          <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <WandSparklesIcon className="size-2.5 text-primary/70" />
            {t("rx.suggestTitle", { code: note.diagnosisCode })}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {suggestions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => addFromDrug(d)}
                title={d.inn}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <PlusIcon className="size-2.5" />
                {d.nameRu}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Doctor presets (legacy text adds) ── */}
      {!disabled && availablePresets.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {availablePresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPresetClick(p)}
              title={
                p.noteTemplate
                  ? t("structured.presetTitleWithTemplate")
                  : t("structured.presetTitle")
              }
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              {p.noteTemplate && (
                <WandSparklesIcon className="size-2.5 text-primary/70" />
              )}
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Custom drug mini-form ── */}
      {customOpen && !disabled && (
        <CustomRowForm
          onCancel={() => setCustomOpen(false)}
          onAdd={(displayName, dose) => {
            addDraft({
              drugId: null,
              displayName,
              form: null,
              strength: null,
              dose,
              timesOfDay: [],
              mealRelation: "NO_MATTER",
              durationDays: null,
              instructionRu: null,
              instructionUz: null,
              remindPatient: true,
            });
            setCustomOpen(false);
          }}
        />
      )}

      {/* ── Structured rows ── */}
      {rows.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {rows.map((row, i) => (
            <PrescriptionRowItem
              key={`${i}-${row.displayName}`}
              row={row}
              locale={locale}
              disabled={disabled}
              expanded={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
              onChange={(patch) => updateRow(i, patch)}
              onRemove={() => removeRow(i)}
            />
          ))}
        </ul>
      )}

      {rows.length === 0 && legacy.length === 0 && !customOpen && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {disabled ? "—" : t("rx.empty")}
        </p>
      )}

      {/* ── Legacy text lines (old notes / protocol templates / presets) ── */}
      {legacy.length > 0 && (
        <div className="mt-1.5">
          {rows.length > 0 && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("rx.legacyTitle")}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {legacy.map((chip) => (
              <span
                key={chip}
                className="inline-flex h-6 items-center gap-0.5 rounded-md border border-primary/20 bg-primary/10 px-1.5 text-[11px] font-medium text-primary"
              >
                {chip}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={t("structured.remove")}
                    onClick={() => onRemoveLegacyChip(chip)}
                    className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-sm text-primary/60 transition-colors hover:bg-primary/15 hover:text-primary"
                  >
                    <XIcon className="size-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custom drug mini-form ─────────────────────────────────────────────

function CustomRowForm({
  onAdd,
  onCancel,
}: {
  onAdd: (displayName: string, dose: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const [name, setName] = React.useState("");
  const [dose, setDose] = React.useState("");
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canAdd = !!name.trim() && !!dose.trim();
  const submit = () => {
    if (!canAdd) return;
    onAdd(name.trim(), dose.trim());
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] p-1.5">
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("rx.customName")}
        className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <input
        value={dose}
        onChange={(e) => setDose(e.target.value)}
        placeholder={t("rx.customDose")}
        className="h-7 w-40 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <button
        type="button"
        disabled={!canAdd}
        onClick={submit}
        className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {t("rx.add")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t("cds.cancel")}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

// ── Single row ────────────────────────────────────────────────────────

function PrescriptionRowItem({
  row,
  locale,
  disabled,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  row: VisitPrescriptionRow;
  locale: PrescriptionLocale;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<VisitPrescriptionDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const line = formatPrescriptionLine(row, locale);

  return (
    <li
      className={cn(
        "rounded-lg border bg-card",
        expanded ? "border-primary/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDownIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded ? "" : "-rotate-90",
            )}
          />
          <span className="truncate text-xs font-medium text-foreground">
            {line}
          </span>
          {!row.drugId && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("rx.manualBadge")}
            </span>
          )}
        </button>
        {!disabled && (
          <>
            <button
              type="button"
              onClick={() => onChange({ remindPatient: !row.remindPatient })}
              title={row.remindPatient ? t("rx.remindOn") : t("rx.remindOff")}
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                row.remindPatient
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground",
              )}
            >
              {row.remindPatient ? (
                <BellIcon className="size-3.5" />
              ) : (
                <BellOffIcon className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t("rx.deleteRow")}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {expanded && !disabled && (
        <div className="flex flex-col gap-2 border-t border-border/70 px-2 py-2">
          {/* Dose */}
          <LabeledRow label={t("rx.dose")}>
            <CommitInput
              value={row.dose}
              required
              onCommit={(v) => onChange({ dose: v })}
              className="h-7 w-44"
            />
          </LabeledRow>

          {/* Times of day */}
          <LabeledRow label={t("rx.timesLabel")}>
            <div className="flex flex-wrap gap-1">
              {TIMES.map((tm) => {
                const active = row.timesOfDay.includes(tm);
                return (
                  <SegChip
                    key={tm}
                    active={active}
                    onClick={() =>
                      onChange({
                        timesOfDay: active
                          ? row.timesOfDay.filter((x) => x !== tm)
                          : TIMES.filter(
                              (x) => row.timesOfDay.includes(x) || x === tm,
                            ),
                      })
                    }
                  >
                    {t(`rx.times.${tm}`)}
                  </SegChip>
                );
              })}
            </div>
          </LabeledRow>

          {/* Meal relation */}
          <LabeledRow label={t("rx.mealLabel")}>
            <div className="flex flex-wrap gap-1">
              {MEALS.map((m) => (
                <SegChip
                  key={m}
                  active={row.mealRelation === m}
                  onClick={() => onChange({ mealRelation: m })}
                >
                  {t(`rx.meal.${m}`)}
                </SegChip>
              ))}
            </div>
          </LabeledRow>

          {/* Duration */}
          <LabeledRow label={t("rx.duration")}>
            <div className="flex flex-wrap items-center gap-1">
              {DURATION_PICKS.map((d) => (
                <SegChip
                  key={d}
                  active={row.durationDays === d}
                  onClick={() =>
                    onChange({ durationDays: row.durationDays === d ? null : d })
                  }
                >
                  {d}
                </SegChip>
              ))}
              <CommitInput
                value={row.durationDays != null ? String(row.durationDays) : ""}
                placeholder="—"
                onCommit={(v) => {
                  const n = parseInt(v, 10);
                  onChange({
                    durationDays:
                      Number.isFinite(n) && n >= 1 && n <= 365 ? n : null,
                  });
                }}
                className="h-7 w-16 text-center"
              />
            </div>
          </LabeledRow>

          {/* Instruction (how to take — goes to the handout/print) */}
          <LabeledRow label={t("rx.instruction")}>
            <CommitInput
              value={
                (locale === "uz" ? row.instructionUz : row.instructionRu) ?? ""
              }
              placeholder={t("rx.instructionPlaceholder")}
              onCommit={(v) =>
                onChange(
                  locale === "uz"
                    ? { instructionUz: v || null }
                    : { instructionRu: v || null },
                )
              }
              className="h-7 w-full"
            />
          </LabeledRow>
        </div>
      )}
    </li>
  );
}

// ── Tiny primitives ───────────────────────────────────────────────────

function LabeledRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function SegChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Input that keeps a local draft and commits on blur/Enter — avoids a PATCH per keystroke. */
function CommitInput({
  value,
  onCommit,
  required,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const v = draft.trim();
    if (v === value) return;
    if (required && !v) {
      setDraft(value);
      return;
    }
    onCommit(v);
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
        }
      }}
      placeholder={placeholder}
      className={cn(
        "rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20",
        className,
      )}
    />
  );
}
