"use client";

/**
 * Ф2 (TZ-smart-constructor) — structured prescription constructor.
 *
 * Replaces the free-text chip input for the prescriptions field. Doctor
 * searches the DB drug catalog (brand/INN/ATC, top-12), picking a drug
 * auto-fills form/strength from Drug.forms and the how-to-take text from
 * Drug.defaultDosing.adult; the schedule (times of day, meal relation,
 * duration) is set with segment controls. «Свой препарат» adds the drug to
 * the clinic's base (visible to every doctor from then on) and prescribes it.
 *
 * Tapping the empty search field opens the doctor's shortlist — his own most
 * prescribed drugs, what is usual for the chosen diagnosis, the clinic's core
 * list and his templates. Nothing else is on the card: the rest of the
 * catalog is one search away (clinic request 25.09.2026, «лишнее скрыть»).
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
  Loader2Icon,
  PillIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  matchedBrand,
  prescriptionLabel,
} from "@/lib/catalogs/brand-match";
import {
  formatPrescriptionLine,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";

import type { DoctorPresetRow } from "../_hooks/use-doctor-presets";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";
import {
  AddClinicDrugError,
  useAddClinicDrug,
  useDrugShortlist,
  type DrugShortItem,
} from "../_hooks/use-shortlists";
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

/**
 * Build a structured row draft from a catalog drug (search hit or drawer
 * pick). `term` is what the doctor typed: when it names a brand the row is
 * labelled «Мидокалм (толперизон)» rather than the bare substance — the
 * clinic reported typing a brand and getting back a word the patient will
 * never see on the box.
 */
export function draftFromDrug(
  d: Pick<DrugSearchHit, "id" | "nameRu" | "forms" | "defaultDosing"> & {
    brands?: { name: string }[];
  },
  term = "",
): VisitPrescriptionDraft {
  const firstForm = d.forms?.[0] ?? null;
  const strength = firstForm?.strengths?.[0] ?? null;
  return {
    drugId: d.id,
    displayName: prescriptionLabel(
      { nameRu: d.nameRu, brands: d.brands ?? [] },
      term,
    ),
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

/**
 * A shortlist pick as a row draft. His own items keep the wording he used
 * last time and his last dose; the clinic's core-list items are labelled
 * with the clinic's name («Анаприлин (пропранолол)») and its usual strength.
 */
function draftFromShortItem(
  item: DrugShortItem,
  kind: "mine" | "clinic",
): VisitPrescriptionDraft {
  if (item.drug) {
    const base = draftFromDrug(item.drug, item.label);
    const strength = item.strengths[0] ?? base.strength;
    return {
      ...base,
      displayName:
        kind === "mine" && item.label ? item.label : base.displayName,
      strength,
      dose: item.lastDose ?? strength ?? base.dose,
    };
  }
  // A free-typed line from his history: «Магне B6 — по 2 таб 2 раза…».
  // The part after the dash is the dose as he wrote it.
  const { name, dose } = splitFreeLine(item.label);
  return {
    drugId: null,
    displayName: name,
    form: null,
    strength: null,
    dose: dose ?? item.lastDose ?? "1",
    timesOfDay: [],
    mealRelation: "NO_MATTER",
    durationDays: null,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
  };
}

/** «Магне B6 — по 2 таб…» → name + dose; a line without a dash has none. */
function splitFreeLine(line: string): { name: string; dose: string | null } {
  const [name, ...rest] = line.split(" — ");
  return {
    name: (name ?? line).trim(),
    dose: rest.join(" — ").trim() || null,
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
  /**
   * Insert a free-text line verbatim. A history line with no dose part
   * («Мексидол 5,0 в/м №10») goes in exactly as he wrote it, as it always did.
   */
  onAddLegacyLine?: (line: string) => void;
  /**
   * The tap-to-open shortlist (his frequent drugs, the clinic's core list,
   * templates) and «add to the clinic's base». Off on the corrections
   * screen: a correction is a targeted fix, not a new prescribing session.
   */
  shortlist?: boolean;
  onRemoveLegacyChip: (chip: string) => void;
  onOpenCatalog: () => void;
  /** Render as a top-level panel card instead of an inset sub-card. */
  standalone?: boolean;
  /** Shared save-in-flight flag for the header spinner (standalone hosts). */
  saving?: boolean;
};

export function PrescriptionConstructor({
  note,
  disabled,
  presets,
  onSaveRows,
  onPresetClick,
  onAddLegacyLine,
  shortlist = true,
  onRemoveLegacyChip,
  onOpenCatalog,
  standalone,
  saving,
}: Props) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";

  const rows = React.useMemo(
    () => note.visitPrescriptions ?? [],
    [note.visitPrescriptions],
  );
  // Memoised: `?? []` would mint a new array each render and re-run every
  // hook that depends on it.
  const legacy = React.useMemo(
    () => note.prescriptions ?? [],
    [note.prescriptions],
  );

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

  // The shortlist: what he prescribes, then the clinic's core list. Anything
  // already on this visit is left out — re-offering what is on screen is noise.
  const shortlistQuery = useDrugShortlist(!disabled && shortlist);
  const { pinned: pinnedDrugs, toggle: togglePinnedDrug } =
    useDoctorFavorites("DRUG");
  const onScreen = React.useMemo(
    () =>
      new Set(
        [...rows.map((r) => r.displayName), ...legacy].map((s) =>
          s.trim().toLowerCase(),
        ),
      ),
    [rows, legacy],
  );
  const notOnScreen = (i: DrugShortItem) =>
    !(i.drugId && addedDrugIds.has(i.drugId)) &&
    !onScreen.has(i.label.trim().toLowerCase()) &&
    !onScreen.has(splitFreeLine(i.label).name.toLowerCase());
  const mine = (shortlistQuery.data?.mine ?? []).filter(notOnScreen);
  const clinicList = (shortlistQuery.data?.clinic ?? []).filter(notOnScreen);
  const [presetsOpen, setPresetsOpen] = React.useState(false);

  // The latest rows, for an add that resolves after an await: saving is
  // replace-all, so a list captured at click time would undo whatever the
  // doctor changed while the request was in flight.
  const rowsRef = React.useRef(rows);
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const addDraft = React.useCallback(
    (draft: VisitPrescriptionDraft) => {
      const current = rowsRef.current;
      onSaveRows([...toDrafts(current), draft]);
      setExpanded(current.length);
    },
    [onSaveRows],
  );

  const addFromDrug = React.useCallback(
    (d: DrugSearchHit) => {
      // Pass the live query so a brand search prescribes «Мидокалм
      // (толперизон)» — the name the patient will look for at the counter.
      addDraft(draftFromDrug(d, query));
      setQuery("");
      setFocused(false);
    },
    [addDraft, query],
  );

  const addFromShort = (item: DrugShortItem, kind: "mine" | "clinic") => {
    if (!item.drug && !splitFreeLine(item.label).dose && onAddLegacyLine) {
      onAddLegacyLine(item.label);
    } else {
      addDraft(draftFromShortItem(item, kind));
    }
    setQuery("");
    setFocused(false);
  };

  // A drug the catalog lacks goes into the clinic's base, so every doctor
  // finds it next time — then onto this visit as a normal catalog row.
  const addClinicDrug = useAddClinicDrug();
  const addToClinicBase = async (rawName: string, dose?: string) => {
    const name = rawName.replace(/\s+/g, " ").trim();
    if (name.length < 3 || addClinicDrug.isPending) return;
    try {
      const { drug, created } = await addClinicDrug.mutateAsync(name);
      const base = draftFromDrug(drug, name);
      addDraft({ ...base, displayName: name, dose: dose?.trim() || base.dose });
      toast.success(
        created
          ? t("rx.addedToClinic", { name })
          : t("rx.foundInClinic", { name }),
      );
      setQuery("");
      setFocused(false);
      setCustomOpen(false);
    } catch (e) {
      // Never block prescribing on the shared base: the drug still goes on
      // this visit as a one-off line, and the doctor is told why it was not
      // shared.
      addDraft({
        drugId: null,
        displayName: name,
        form: null,
        strength: null,
        dose: dose?.trim() || "1",
        timesOfDay: [],
        mealRelation: "NO_MATTER",
        durationDays: null,
        instructionRu: null,
        instructionUz: null,
        remindPatient: true,
      });
      setQuery("");
      setFocused(false);
      setCustomOpen(false);
      toast.warning(
        e instanceof AddClinicDrugError && e.reason === "hidden_by_clinic"
          ? t("rx.hiddenByClinic", { name })
          : e instanceof AddClinicDrugError && e.status === 429
            ? t("rx.addRateLimited")
            : t("rx.addToClinicError"),
      );
    }
  };

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


  return (
    <div
      className={cn(
        standalone
          ? "rounded-2xl border border-border bg-card p-4"
          : "rounded-xl border border-border bg-background px-2.5 py-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PillIcon className="size-3" />
          </span>
          <span
            className={cn(
              "font-semibold text-foreground",
              standalone ? "text-sm" : "text-xs",
            )}
          >
            {t("fields.prescriptions.label")}
          </span>
          {saving && (
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
          )}
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

      {/* ── Catalog search ──
          Empty field + focus → the doctor's shortlist. Typing → the whole
          catalog, with «add to the clinic's base» as the last resort. */}
      {!disabled && (
        <div className="relative mt-1.5">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
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
              if (shortlist && shortlistQuery.isStale) void shortlistQuery.refetch();
            }}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={
              shortlist ? t("rx.searchPlaceholderTap") : t("rx.searchPlaceholder")
            }
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {focused && shortlist && query.trim().length < 2 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
              {mine.length > 0 && (
                <ShortSection title={t("rx.shortMine")}>
                  {mine.map((item) => (
                    <ShortRow
                      key={`mine-${item.key}`}
                      label={item.label}
                      sub={item.lastDose}
                      count={item.count}
                      countTitle={t("rx.shortCount", { n: item.count })}
                      pinned={item.drugId ? pinnedDrugs.has(item.drugId) : null}
                      pinTitle={
                        item.drugId && pinnedDrugs.has(item.drugId)
                          ? t("diagnosis.favRemove")
                          : t("diagnosis.favAdd")
                      }
                      onPin={
                        item.drugId
                          ? () => togglePinnedDrug(item.drugId!)
                          : undefined
                      }
                      onPick={() => addFromShort(item, "mine")}
                    />
                  ))}
                </ShortSection>
              )}
              {note.diagnosisCode && suggestions.length > 0 && (
                <ShortSection
                  title={t("rx.suggestTitle", { code: note.diagnosisCode })}
                >
                  {suggestions.slice(0, 6).map((d) => (
                    <ShortRow
                      key={`sug-${d.id}`}
                      label={d.nameRu}
                      sub={d.forms?.[0]?.strengths?.slice(0, 3).join(" / ") || null}
                      onPick={() => addFromDrug(d)}
                    />
                  ))}
                </ShortSection>
              )}
              {clinicList.length > 0 && (
                <ShortSection title={t("rx.shortClinic")}>
                  {clinicList.map((item) => (
                    <ShortRow
                      key={`clinic-${item.key}`}
                      label={item.label}
                      sub={
                        [
                          item.strengths.join(" / "),
                          item.drug && !item.drug.rxOnly ? t("rx.otc") : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || null
                      }
                      pinned={item.drugId ? pinnedDrugs.has(item.drugId) : null}
                      pinTitle={t("diagnosis.favAdd")}
                      onPin={
                        item.drugId
                          ? () => togglePinnedDrug(item.drugId!)
                          : undefined
                      }
                      onPick={() => addFromShort(item, "clinic")}
                    />
                  ))}
                </ShortSection>
              )}
              {presets.length > 0 && (
                <div className="border-t border-border/60 px-3 py-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Keep the list open while it expands.
                      e.preventDefault();
                      setPresetsOpen((v) => !v);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3 transition-transform",
                        presetsOpen ? "" : "-rotate-90",
                      )}
                    />
                    {t("rx.shortTemplates", { n: presets.length })}
                  </button>
                  {presetsOpen && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {presets.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onPresetClick(p);
                            setFocused(false);
                          }}
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
                </div>
              )}
              {mine.length === 0 &&
                clinicList.length === 0 &&
                suggestions.length === 0 &&
                presets.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">
                    {shortlistQuery.isLoading ? "…" : t("rx.shortEmpty")}
                  </p>
                )}
            </div>
          )}
          {focused && query.trim().length >= 2 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
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
                    {/* The box itself — the doctor recognises a pack faster
                        than a name, and can turn the screen to the patient. */}
                    {d.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.photoUrl}
                        alt=""
                        className="mt-0.5 size-8 shrink-0 rounded-md border border-border bg-white object-contain"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        {/* Lead with what the doctor typed: a brand query
                            shows the brand, the substance moves below. */}
                        <span className="font-medium text-foreground">
                          {matchedBrand(
                            { nameRu: d.nameRu, brands: d.brands },
                            query,
                          ) ?? d.nameRu}
                        </span>
                        {d.forms?.[0]?.strengths?.[0] && (
                          <span className="text-xs text-muted-foreground">
                            {d.forms[0].strengths.join(" / ")}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {d.nameRu}
                        {/* Register molecules carry up to 25 trade names —
                            show the first few, count the rest. */}
                        {d.brands.length > 0
                          ? ` · ${d.brands
                              .slice(0, 3)
                              .map((b) => b.name)
                              .join(", ")}${
                              d.brands.length > 3
                                ? ` +${d.brands.length - 3}`
                                : ""
                            }`
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
              {/* Not in the catalog under this name: add it for the whole
                  clinic instead of a one-off line nobody else will find. */}
              {shortlist && !searchQuery.isFetching && query.trim().length >= 3 && (
                <li className={hits.length > 0 ? "border-t border-border/60" : ""}>
                  <button
                    type="button"
                    disabled={addClinicDrug.isPending}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void addToClinicBase(query);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {addClinicDrug.isPending ? (
                      <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <PlusIcon className="size-3.5 shrink-0 text-primary" />
                    )}
                    <span className="text-foreground">
                      {t("rx.addToClinic", { name: query.trim() })}
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ── Custom drug mini-form ── */}
      {customOpen && !disabled && (
        <CustomRowForm
          pending={addClinicDrug.isPending}
          onCancel={() => setCustomOpen(false)}
          onAdd={(displayName, dose) => void addToClinicBase(displayName, dose)}
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
  pending,
}: {
  onAdd: (displayName: string, dose: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const t = useTranslations("doctor.reception");
  const [name, setName] = React.useState("");
  const [dose, setDose] = React.useState("");
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // The dose is optional now: the row opens for editing right after.
  const canAdd = name.trim().length >= 3 && !pending;
  const submit = () => {
    if (!canAdd) return;
    onAdd(name.trim(), dose.trim());
  };

  return (
    <div className="mt-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] p-1.5">
    <div className="flex items-center gap-1.5">
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("rx.customName")}
        maxLength={120}
        className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onCancel();
          }
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
        className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {pending && <Loader2Icon className="size-3 animate-spin" />}
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
    <p className="mt-1 px-0.5 text-[10px] leading-snug text-muted-foreground">
      {t("rx.customSharedHint")}
    </p>
    </div>
  );
}

// ── Shortlist pieces ──────────────────────────────────────────────────

function ShortSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-0.5 [&+&]:border-t [&+&]:border-border/60">
      <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function ShortRow({
  label,
  sub,
  count,
  countTitle,
  pinned,
  pinTitle,
  onPin,
  onPick,
}: {
  label: string;
  sub?: string | null;
  count?: number;
  countTitle?: string;
  /** null = this row cannot be starred (free-typed history line). */
  pinned?: boolean | null;
  pinTitle?: string;
  onPin?: () => void;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onPick();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{label}</span>
          {sub ? (
            <span className="block truncate text-[11px] text-muted-foreground">
              {sub}
            </span>
          ) : null}
        </span>
        {count && count > 0 ? (
          <span
            title={countTitle}
            className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground"
          >
            {count}
          </span>
        ) : null}
        {onPin && pinned !== null && pinned !== undefined ? (
          <span
            role="button"
            tabIndex={-1}
            title={pinTitle}
            onMouseDown={(e) => {
              // Star, don't pick: keep the list open.
              e.preventDefault();
              e.stopPropagation();
              onPin();
            }}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              pinned
                ? "text-amber-500"
                : "text-muted-foreground/40 hover:text-amber-500",
            )}
          >
            <StarIcon className={cn("size-3.5", pinned ? "fill-amber-400" : "")} />
          </span>
        ) : null}
      </button>
    </li>
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
          {/* The pack, right in the prescription line — the doctor can turn
              the screen and say «вот эту коробку». */}
          {row.drug?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.drug.photoUrl}
              alt=""
              className="size-7 shrink-0 rounded-md border border-border bg-white object-contain"
            />
          ) : null}
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
