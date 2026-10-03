"use client";

/**
 * Ф2 (TZ-smart-constructor) — structured prescription constructor.
 *
 * Replaces the free-text chip input for the prescriptions field. Doctor
 * searches the DB drug catalog (brand/INN/ATC, top-12), picking a drug
 * auto-fills form/strength from Drug.forms; the schedule (times of day, meal
 * relation, duration) is set with segment controls, and the how-to-take text
 * is the doctor's own (see draftFromDrug). «Свой препарат» adds the drug to
 * the clinic's base (visible to every doctor from then on) and prescribes it.
 *
 * A pick whose dose the catalog cannot give (insulin, syrups, drops,
 * injections, creams: their «strength» is a concentration or a pack) is not
 * added at once: a small form asks for the dose first, with the drug's forms
 * and strengths to choose from (audit G4-07, see drug-forms.ts). A saved row
 * can switch its form too.
 *
 * On the visit screen the drugs are picked with the mouse (clinic request
 * 03.10.2026): three columns always on screen, his frequent drugs, his
 * stars and the catalog by clicks, each one click from the visit with his
 * usual dose and schema (see prescription-picker.tsx). The search stays as
 * an extra on top of them. The corrections screen keeps the plain search.
 * A dose the catalog cannot give is answered with one click too: the
 * prompt offers the doses that form is written in (quick-doses.ts).
 *
 * Persistence is replace-all via PATCH {visitPrescriptions: [...]} — the
 * same autosave model as the chip fields. Legacy text lines
 * (note.prescriptions — old notes, protocol templates, presets) render
 * below the structured rows and stay removable.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellIcon,
  BellOffIcon,
  BookOpenIcon,
  ChevronDownIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useRevealOnOpen } from "@/hooks/use-reveal-on-open";
import { matchedBrand } from "@/lib/catalogs/brand-match";
import {
  normalizeForms,
  withForm,
  withStrength,
  type DrugFormOption,
} from "@/lib/catalogs/drug-forms";
import {
  formatPrescriptionHead,
  formatPrescriptionLine,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";
import { reminderStateOf } from "@/lib/catalogs/dosing-times";
import { quickDoseOptions } from "@/lib/catalogs/quick-doses";

import { useFormLabel } from "../../_components/drug-detail";

import type { DoctorPresetRow } from "../_hooks/use-doctor-presets";
import {
  AddClinicDrugError,
  useAddClinicDrug,
  useDrugShortlist,
  type DrugShortItem,
} from "../_hooks/use-shortlists";
import { useDrugSearch, type DrugSearchHit } from "../_hooks/use-drug-search";
import {
  visitNoteKey,
  type VisitNoteRow,
  type VisitPrescriptionDraft,
  type VisitPrescriptionMealRelation,
  type VisitPrescriptionRow,
  type VisitPrescriptionTimeOfDay,
} from "../_hooks/use-visit-note";
import {
  draftFromCatalogPick,
  draftFromDrug,
  draftFromShortItem,
  shortItemKind,
  splitFreeLine,
  toggleTimeOfDay,
  toPrescriptionDrafts,
  withRowEdited,
  withRowRemoved,
  type DraftPick,
  type RowEdit,
} from "../_hooks/prescription-rows";
import { onVisitChecker } from "../_hooks/prescription-columns";
import { PrescriptionPicker } from "./prescription-picker";

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

/** What a catalog pick carries: enough to build a row draft. */
export type CatalogPickDrug = Parameters<typeof draftFromDrug>[0];

/**
 * What the card above the picker's columns can do with the rows: the same
 * add path as a click in the columns (dose first, his own text lines as
 * they are), and the same «already on the visit» rule as their marks.
 */
export type PrescriptionPickApi = {
  addItem: (item: DrugShortItem) => void;
  /** Several at once, in one save («Добавить всё»). */
  addItems: (items: readonly DrugShortItem[]) => void;
  isOnVisit: (item: { drugId: string | null; label: string }) => boolean;
};

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
   * The mouse-first picker (his frequent drugs, his stars, the catalog by
   * clicks, see prescription-picker.tsx) and «add to the clinic's base».
   * Off on the corrections screen: a correction is a targeted fix, not a
   * new prescribing session, and keeps the plain search.
   */
  shortlist?: boolean;
  onRemoveLegacyChip: (chip: string) => void;
  onOpenCatalog: () => void;
  /**
   * Filled by the constructor: how a drug picked in the catalog drawer (which
   * its host renders) becomes a row, through the same «dose first» step as
   * a search pick.
   */
  catalogPickRef?: React.MutableRefObject<
    ((drug: CatalogPickDrug, term: string) => void) | null
  >;
  /** Render as a top-level panel card instead of an inset sub-card. */
  standalone?: boolean;
  /** Shared save-in-flight flag for the header spinner (standalone hosts). */
  saving?: boolean;
  /**
   * Rendered inside the card above the picker's columns: the place for
   * suggestions tied to the visit («Обычно при <диагноз>»), where the
   * doctor's eye already is when he starts prescribing. It gets the
   * constructor's add path, so a suggestion lands exactly like a pick.
   */
  aboveColumns?: (api: PrescriptionPickApi) => React.ReactNode;
  /**
   * Rendered inside the card under the rows: the visit screen puts the
   * interaction check there, so a warning sits with the drugs it is about.
   */
  footer?: React.ReactNode;
};

/**
 * The visit screen's card is read by a doctor who asked for bigger type
 * (03.10.2026); the corrections screen keeps its compact inset card. The row
 * editor's chips and inputs read this instead of a prop through every level.
 */
const BigUi = React.createContext(false);

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
  catalogPickRef,
  standalone,
  saving,
  aboveColumns,
  footer,
}: Props) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";
  const big = !!standalone;

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
  // A pick waiting for its dose (audit G4-07): not saved until written.
  // Tied to its note: switching to the next patient must not carry it over.
  const [pending, setPending] = React.useState<
    (DraftPick & { noteId: string }) | null
  >(null);
  const pendingOpen = !!pending && pending.noteId === note.id && !disabled;
  // Scrolled clear of the sticky «Завершить приём» bar when it opens.
  const pendingRef = useRevealOnOpen<HTMLDivElement>(pendingOpen);

  // The plain search: only where the picker is off (corrections screen).
  const searchQuery = useDrugSearch(shortlist ? "" : query);
  const hits = searchQuery.data ?? [];
  const hitsOpen = !shortlist && focused && query.trim().length >= 2;
  const hitsListRef = useRevealOnOpen<HTMLUListElement>(hitsOpen);

  // His usual dose and schema per drug: a pick from the search, the drawer
  // or the catalog column comes back as he writes it. Shared with the
  // picker (one query key, one request).
  const shortlistQuery = useDrugShortlist(!disabled && shortlist);
  const usual = shortlistQuery.data?.usual;

  // Saving is replace-all, so every action (add, edit, remove) is composed
  // on the rows as the doctor last left them, not on this render's snapshot
  // (audit VW-01). The query cache holds them: `usePatchVisitNote` writes
  // each edit there the moment it is made, before the request leaves, and
  // keeps an older response from overwriting a newer pending edit. The
  // render snapshot only knows what the last server answer said, so two
  // quick actions built on it (dose, then a time chip; two drugs in a row)
  // silently undid the first one. The ref is the fallback for a host whose
  // note is not in the cache.
  const qc = useQueryClient();
  const rowsRef = React.useRef(rows);
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const noteId = note.id;
  const liveDrafts = React.useCallback(
    (): VisitPrescriptionDraft[] =>
      toPrescriptionDrafts(
        qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))
          ?.visitPrescriptions ?? rowsRef.current,
      ),
    [qc, noteId],
  );

  const addDraft = React.useCallback(
    (draft: VisitPrescriptionDraft, forms: DrugFormOption[] = []) => {
      // No dose the catalog can vouch for: the doctor writes it first. A
      // row is never saved with a concentration or a pack in «Доза».
      if (!draft.dose.trim()) {
        setPending({ draft, forms, noteId });
        return;
      }
      const current = liveDrafts();
      onSaveRows([...current, draft]);
      // Opened for its schedule; a row that came back with his usual one
      // has nothing left to set and stays a single line.
      setExpanded(draft.timesOfDay.length > 0 ? null : current.length);
    },
    [onSaveRows, liveDrafts, noteId],
  );

  /** A catalog drug (search hit, drawer, catalog column) with what was typed. */
  const addFromCatalog = React.useCallback(
    (drug: CatalogPickDrug, term: string) => {
      const { draft, forms } = draftFromCatalogPick(drug, usual?.[drug.id], term);
      addDraft(draft, forms);
    },
    [addDraft, usual],
  );

  const addFromDrug = React.useCallback(
    (d: DrugSearchHit) => {
      // Pass the live query so a brand search prescribes «Мидокалм
      // (толперизон)» — the name the patient will look for at the counter.
      addFromCatalog(d, query);
      setQuery("");
      setFocused(false);
    },
    [addFromCatalog, query],
  );

  React.useEffect(() => {
    if (!catalogPickRef) return;
    catalogPickRef.current = addFromCatalog;
    return () => {
      catalogPickRef.current = null;
    };
  }, [catalogPickRef, addFromCatalog]);

  /**
   * His own text line with nothing to structure («Мексидол 5,0 в/м №10»):
   * it goes in exactly as he wrote it. A manual row of his with a dose of
   * its own is a row again, dose and schema included.
   */
  const isPlainLine = (item: DrugShortItem) =>
    !item.drug &&
    !splitFreeLine(item.label).dose &&
    !item.lastDose?.trim() &&
    !!onAddLegacyLine;

  /** A picker item: his history, a star, the core list or a catalog drug. */
  const addFromShort = (item: DrugShortItem) => {
    if (isPlainLine(item)) {
      onAddLegacyLine?.(item.label);
      return;
    }
    const { draft, forms } = draftFromShortItem(item, shortItemKind(item));
    addDraft(draft, forms);
  };

  /**
   * Several items in one go («Добавить всё»): the rows in ONE replace-all
   * save, his text lines one by one (each composes on the live cache). A
   * row the catalog cannot give a dose for still asks for it first: the
   * first such row opens the dose prompt, and the others wait for another
   * click, since the prompt holds one pick at a time.
   */
  const addItems = (items: readonly DrugShortItem[]) => {
    const drafts: VisitPrescriptionDraft[] = [];
    const lines: string[] = [];
    let needsDose: DraftPick | null = null;
    for (const item of items) {
      if (isPlainLine(item)) {
        lines.push(item.label);
        continue;
      }
      const pick = draftFromShortItem(item, shortItemKind(item));
      if (!pick.draft.dose.trim()) {
        needsDose ??= pick;
        continue;
      }
      drafts.push(pick.draft);
    }
    if (drafts.length > 0) {
      onSaveRows([...liveDrafts(), ...drafts]);
      setExpanded(null);
    }
    for (const line of lines) onAddLegacyLine?.(line);
    if (needsDose) setPending({ ...needsDose, noteId });
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
      addDraft(
        { ...base, displayName: name, dose: dose?.trim() || base.dose },
        normalizeForms(drug.forms),
      );
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
        dose: dose?.trim() || "",
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
    (index: number, edit: RowEdit) => {
      const next = withRowEdited(liveDrafts(), index, edit);
      if (next) onSaveRows(next);
    },
    [liveDrafts, onSaveRows],
  );

  const removeRow = React.useCallback(
    (index: number) => {
      const next = withRowRemoved(liveDrafts(), index);
      if (next) onSaveRows(next);
      setExpanded(null);
    },
    [liveDrafts, onSaveRows],
  );

  const picker = shortlist && !disabled;
  // The picker marks with the same rule (prescription-columns.ts).
  const onVisit = React.useMemo(() => onVisitChecker(rows, legacy), [rows, legacy]);

  const pendingForm = pendingOpen && pending ? (
    <div ref={pendingRef} className="scroll-mb-28">
      <PendingDoseForm
        pick={pending}
        locale={locale}
        onChange={(draft) => setPending((p) => (p ? { ...p, draft } : p))}
        onCancel={() => setPending(null)}
        onAdd={() => {
          const { draft, forms } = pending;
          setPending(null);
          addDraft({ ...draft, dose: draft.dose.trim() }, forms);
        }}
      />
    </div>
  ) : null;

  const customForm =
    customOpen && !disabled ? (
      <CustomRowForm
        pending={addClinicDrug.isPending}
        onCancel={() => setCustomOpen(false)}
        onAdd={(displayName, dose) => void addToClinicBase(displayName, dose)}
      />
    ) : null;

  return (
    <BigUi.Provider value={big}>
    <div
      className={cn(
        standalone
          ? "rounded-2xl border border-border bg-card p-4"
          : "rounded-xl border border-border bg-background px-2.5 py-2",
      )}
    >
      {/* Wraps: when the card is narrow the buttons move to their own line
          instead of pushing «Свой препарат» out past the card's edge. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className={cn("inline-flex items-center", big ? "gap-2" : "gap-1.5")}>
          <span
            className={cn(
              "inline-flex items-center justify-center bg-muted text-muted-foreground",
              big ? "size-8 rounded-lg" : "size-5 rounded-md",
            )}
          >
            <PillIcon className={big ? "size-4" : "size-3"} />
          </span>
          <span
            className={cn(
              "font-semibold text-foreground",
              big ? "text-base" : "text-xs",
            )}
          >
            {t("fields.prescriptions.label")}
          </span>
          {saving && (
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
          )}
          {rows.length + legacy.length > 0 && (
            <span
              className={cn(
                "rounded-md bg-muted font-semibold tabular-nums text-muted-foreground",
                big ? "px-1.5 text-xs" : "px-1 text-[10px]",
              )}
            >
              {rows.length + legacy.length}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenCatalog}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50",
              big ? "h-9 rounded-lg px-3 text-sm" : "h-6 px-1.5 text-[11px]",
            )}
            title={t("structured.catalogTitle")}
          >
            <BookOpenIcon className={big ? "size-4" : "size-3"} />
            {t("structured.catalog")}
          </button>
          <button
            type="button"
            disabled={disabled || customOpen}
            onClick={() => setCustomOpen(true)}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50",
              big ? "h-9 rounded-lg px-3 text-sm" : "h-6 px-1.5 text-[11px]",
            )}
          >
            <PlusIcon className={big ? "size-4" : "size-3"} />
            {t("rx.custom")}
          </button>
        </div>
      </div>

      {picker ? (
        <>
          {/* The prescribing area: suggestions for this visit, a pick
              waiting for its dose, the custom form, then the columns. The
              rows come after it, so a new row never pushes the columns
              down under the doctor's cursor. */}
          {aboveColumns ? (
            <div className="mt-3 empty:hidden">
              {aboveColumns({
                addItem: addFromShort,
                addItems,
                isOnVisit: onVisit,
              })}
            </div>
          ) : null}
          {pendingForm}
          {customForm}
          <PrescriptionPicker
            noteId={note.id}
            diagnosisCode={note.diagnosisCode}
            rows={rows}
            legacy={legacy}
            presets={presets}
            onPresetClick={onPresetClick}
            onPickItem={addFromShort}
            onPickHit={addFromCatalog}
            onAddToClinicBase={(name) => void addToClinicBase(name)}
            addingToClinic={addClinicDrug.isPending}
          />
        </>
      ) : (
        !disabled && (
          // ── Plain catalog search (the corrections screen) ──
          <div className={cn("relative", big ? "mt-3" : "mt-1.5")}>
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
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder={t("rx.searchPlaceholder")}
              className={cn(
                "w-full rounded-lg border border-border bg-card pl-8 pr-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
                big ? "h-9 text-sm" : "h-8 text-xs",
              )}
            />
            {/* z-40 and scroll-mb: above the sticky «Завершить приём» bar (z-30)
                and scrolled clear of it (useRevealOnOpen). */}
            {hitsOpen && (
              <ul
                ref={hitsListRef}
                className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 scroll-mb-28 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md"
              >
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
                          {(normalizeForms(d.forms)[0]?.strengths.length ?? 0) > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {normalizeForms(d.forms)[0]!.strengths.join(" / ")}
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
              </ul>
            )}
          </div>
        )
      )}

      {!picker && pendingForm}
      {!picker && customForm}

      {/* ── Structured rows ── */}
      {rows.length > 0 && (
        <ul className={cn("flex flex-col", big ? "mt-3 gap-1.5" : "mt-1.5 gap-1")}>
          {rows.map((row, i) => (
            <PrescriptionRowItem
              key={`${i}-${row.displayName}`}
              row={row}
              locale={locale}
              large={big}
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
        <p
          className={cn(
            "text-muted-foreground",
            big ? "mt-3 text-sm" : "mt-1.5 text-[11px]",
          )}
        >
          {disabled ? "—" : picker ? t("rx.picker.empty") : t("rx.empty")}
        </p>
      )}

      {/* ── Legacy text lines (old notes / protocol templates / presets) ── */}
      {legacy.length > 0 && (
        <div className={big ? "mt-3" : "mt-1.5"}>
          {rows.length > 0 && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("rx.legacyTitle")}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {legacy.map((chip) => (
              <span
                key={chip}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md border border-primary/20 bg-primary/10 font-medium text-primary",
                  big ? "min-h-8 px-2 text-sm" : "h-6 px-1.5 text-[11px]",
                )}
              >
                {chip}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={t("structured.remove")}
                    onClick={() => onRemoveLegacyChip(chip)}
                    className={cn(
                      "ml-0.5 inline-flex items-center justify-center rounded-sm text-primary/60 transition-colors hover:bg-primary/15 hover:text-primary",
                      big ? "size-6" : "size-3.5",
                    )}
                  >
                    <XIcon className={big ? "size-3.5" : "size-2.5"} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty when the check has nothing to say: then no gap either. */}
      {footer ? <div className="mt-3 empty:hidden">{footer}</div> : null}
    </div>
    </BigUi.Provider>
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
  const big = React.useContext(BigUi);
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
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };
  const field = big ? "h-10 px-3 text-sm" : "h-7 px-2 text-[11px]";

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-primary/40 bg-primary/[0.03]",
        big ? "mt-3 p-2.5" : "mt-1.5 p-1.5",
      )}
    >
    <div className={cn("flex flex-wrap items-center", big ? "gap-2" : "gap-1.5")}>
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("rx.customName")}
        maxLength={120}
        className={cn(
          "min-w-40 flex-1 rounded-md border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/20",
          field,
        )}
        onKeyDown={keys}
      />
      <input
        value={dose}
        onChange={(e) => setDose(e.target.value)}
        placeholder={t("rx.customDose")}
        className={cn(
          "w-40 rounded-md border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/20",
          field,
          big && "w-56",
        )}
        onKeyDown={keys}
      />
      <button
        type="button"
        disabled={!canAdd}
        onClick={submit}
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-primary font-medium text-primary-foreground transition-opacity disabled:opacity-50",
          big ? "h-10 px-4 text-sm" : "h-7 px-2 text-[11px]",
        )}
      >
        {pending && <Loader2Icon className="size-3 animate-spin" />}
        {t("rx.add")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t("cds.cancel")}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
          big ? "size-10" : "size-7",
        )}
      >
        <XIcon className={big ? "size-4" : "size-3.5"} />
      </button>
    </div>
    <p
      className={cn(
        "mt-1 px-0.5 leading-snug text-muted-foreground",
        big ? "text-xs" : "text-[10px]",
      )}
    >
      {t("rx.customSharedHint")}
    </p>
    </div>
  );
}

// ── Single row ────────────────────────────────────────────────────────

function PrescriptionRowItem({
  row,
  locale,
  large,
  disabled,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  row: VisitPrescriptionRow;
  locale: PrescriptionLocale;
  /** The visit screen's wide card: the line in body size. */
  large: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Toggles pass a function of the row's LIVE state: a chip computed from
   * this render's `row` would drop a value set a moment ago (VW-01).
   */
  onChange: (edit: RowEdit) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("doctor.reception");
  // With the instruction: whatever reaches the patient's handout and print
  // must be readable without expanding the row (audit G4-06).
  const line = formatPrescriptionLine(row, locale, { withInstruction: true });
  const rowForms = React.useMemo(
    () => normalizeForms(row.drug?.forms),
    [row.drug?.forms],
  );
  // VW-11: the bell follows the finalize bridge, which reminds only on a
  // row with a time of day. A blue bell on a row without one promised
  // reminders the patient never got.
  const reminder = reminderStateOf(row);

  return (
    <li
      className={cn(
        "rounded-lg border bg-card",
        expanded ? "border-primary/40" : "border-border",
      )}
    >
      <div className={cn("flex items-center gap-1.5", large ? "px-2.5 py-2.5" : "px-2 py-1.5")}>
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
          {/* Wrapped, never cut: the clinic read «Грандаксин 50 мг — по…»
              and had to open the row to see the schedule (29.09.2026). */}
          <span
            className={cn(
              "min-w-0 break-words font-medium leading-snug text-foreground",
              large ? "text-[15px]" : "text-xs",
            )}
          >
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
              onClick={() =>
                onChange((cur) => ({ remindPatient: !cur.remindPatient }))
              }
              title={
                reminder === "on"
                  ? t("rx.remindOn")
                  : reminder === "noTimes"
                    ? t("rx.remindNoTimes")
                    : t("rx.remindOff")
              }
              aria-label={
                reminder === "on"
                  ? t("rx.remindOn")
                  : reminder === "noTimes"
                    ? t("rx.remindNoTimes")
                    : t("rx.remindOff")
              }
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-md transition-colors",
                large ? "size-9" : "size-6",
                reminder === "on"
                  ? "text-primary hover:bg-primary/10"
                  : reminder === "noTimes"
                    ? "text-warning-text hover:bg-warning/10"
                    : "text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground",
              )}
            >
              {row.remindPatient ? (
                <BellIcon className={large ? "size-4" : "size-3.5"} />
              ) : (
                <BellOffIcon className={large ? "size-4" : "size-3.5"} />
              )}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t("rx.deleteRow")}
              title={t("rx.deleteRow")}
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive",
                large ? "size-9" : "size-6",
              )}
            >
              <Trash2Icon className={large ? "size-4" : "size-3.5"} />
            </button>
          </>
        )}
      </div>

      {expanded && !disabled && (
        <div
          className={cn(
            "flex flex-col border-t border-border/70",
            large ? "gap-3 px-3 py-3" : "gap-2 px-2 py-2",
          )}
        >
          {/* Form and strength (audit G4-07): citicoline may be drops, not
              only the injection listed first. A saved row keeps a dose: when
              the new form has no default, the doctor's current one stays. */}
          {rowForms.length > 1 ||
          (rowForms.find((f) => f.form === row.form)?.strengths.length ?? 0) > 1 ? (
            <LabeledRow label={t("rx.form")}>
              <FormStrengthPicker
                forms={rowForms}
                form={row.form}
                strength={row.strength}
                onForm={(form) =>
                  onChange((cur) => {
                    const next = withForm(cur, rowForms, form);
                    return { ...next, dose: next.dose || cur.dose };
                  })
                }
                onStrength={(strength) =>
                  onChange((cur) => {
                    const next = withStrength(cur, strength);
                    return { ...next, dose: next.dose || cur.dose };
                  })
                }
              />
            </LabeledRow>
          ) : null}

          {/* Dose: typed, or one click on the doses this form is written in */}
          <LabeledRow label={t("rx.dose")}>
            <div className="flex flex-wrap items-center gap-1">
              <CommitInput
                value={row.dose}
                required
                onCommit={(v) => onChange({ dose: v })}
                className={large ? "w-52" : "w-44"}
              />
              {large &&
                quickDoseOptions(
                  row.form,
                  rowForms.find((f) => f.form === row.form)?.strengths ?? [],
                  locale,
                ).map((dose) => (
                  <SegChip
                    key={dose}
                    active={row.dose.trim() === dose}
                    onClick={() => onChange({ dose })}
                  >
                    {dose}
                  </SegChip>
                ))}
            </div>
          </LabeledRow>

          {/* Times of day */}
          <LabeledRow label={t("rx.timesLabel")}>
            <div className="flex flex-wrap items-center gap-1">
              {TIMES.map((tm) => {
                const active = row.timesOfDay.includes(tm);
                return (
                  <SegChip
                    key={tm}
                    active={active}
                    onClick={() =>
                      onChange((cur) => ({
                        timesOfDay: toggleTimeOfDay(cur.timesOfDay, tm),
                      }))
                    }
                  >
                    {t(`rx.times.${tm}`)}
                  </SegChip>
                );
              })}
              {reminder === "noTimes" ? (
                <span className="text-[11px] text-warning-text">
                  {t("rx.remindNoTimes")}
                </span>
              ) : null}
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
                    onChange((cur) => ({
                      durationDays: cur.durationDays === d ? null : d,
                    }))
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
                className="w-16 text-center"
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
              className="w-full"
            />
          </LabeledRow>
        </div>
      )}
    </li>
  );
}

// ── A pick waiting for its dose ───────────────────────────────────────

/**
 * Audit G4-07 — a picked drug whose dose the catalog cannot give: its form
 * is liquid, injected or applied, or its strength is a concentration or a
 * pack. The row is added only once the doctor has written the dose, and he
 * can choose another form or strength here first.
 */
function PendingDoseForm({
  pick,
  locale,
  onChange,
  onAdd,
  onCancel,
}: {
  pick: DraftPick;
  locale: PrescriptionLocale;
  onChange: (draft: VisitPrescriptionDraft) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const big = React.useContext(BigUi);
  const { draft, forms } = pick;
  const canAdd = draft.dose.trim().length > 0;
  const submit = () => {
    if (canAdd) onAdd();
  };
  // A mouse answer to «how much?»: the doses this form is written in.
  const quick = quickDoseOptions(
    draft.form,
    forms.find((f) => f.form === draft.form)?.strengths ?? [],
    locale,
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-dashed border-primary/40 bg-primary/[0.03]",
        big ? "mt-3 gap-2.5 p-3" : "mt-1.5 gap-1.5 p-1.5",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 px-0.5 font-medium text-foreground",
          big ? "text-[15px]" : "text-xs",
        )}
      >
        <PillIcon className={cn("shrink-0 text-muted-foreground", big ? "size-4" : "size-3")} />
        <span className="truncate">
          {formatPrescriptionHead({ ...draft, dose: "" })}
        </span>
      </div>
      {forms.length > 1 ||
      (forms.find((f) => f.form === draft.form)?.strengths.length ?? 0) > 1 ? (
        <FormStrengthPicker
          forms={forms}
          form={draft.form}
          strength={draft.strength}
          onForm={(form) => onChange({ ...draft, ...withForm(draft, forms, form) })}
          onStrength={(strength) =>
            onChange({ ...draft, ...withStrength(draft, strength) })
          }
        />
      ) : null}
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={t("rx.picker.quickDose")}>
          {quick.map((dose) => (
            <SegChip
              key={dose}
              active={draft.dose.trim() === dose}
              onClick={() => onChange({ ...draft, dose })}
            >
              {dose}
            </SegChip>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={draft.dose}
          autoFocus
          onChange={(e) => onChange({ ...draft, dose: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder={t("rx.dosePlaceholder")}
          aria-invalid={!canAdd}
          aria-label={t("rx.dose")}
          maxLength={160}
          className={cn(
            "flex-1 rounded-md border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/20",
            big ? "h-10 px-3 text-sm" : "h-7 px-2 text-[11px]",
            canAdd ? "border-border" : "border-destructive/60",
          )}
        />
        <button
          type="button"
          disabled={!canAdd}
          onClick={submit}
          className={cn(
            "inline-flex items-center gap-1 rounded-md bg-primary font-medium text-primary-foreground transition-opacity disabled:opacity-50",
            big ? "h-10 px-4 text-sm" : "h-7 px-2 text-[11px]",
          )}
        >
          {t("rx.add")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("cds.cancel")}
          className={cn(
            "inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
            big ? "size-10" : "size-7",
          )}
        >
          <XIcon className={big ? "size-4" : "size-3.5"} />
        </button>
      </div>
      <p
        className={cn(
          "px-0.5 leading-snug text-muted-foreground",
          big ? "text-xs" : "text-[10px]",
        )}
      >
        {t("rx.doseNeeded")}
      </p>
    </div>
  );
}

/** The drug's forms, then the strengths of the chosen form, as chips. */
function FormStrengthPicker({
  forms,
  form,
  strength,
  onForm,
  onStrength,
}: {
  forms: readonly DrugFormOption[];
  form: string | null;
  strength: string | null;
  onForm: (form: string) => void;
  onStrength: (strength: string) => void;
}) {
  const formLabel = useFormLabel();
  const strengths = forms.find((f) => f.form === form)?.strengths ?? [];
  return (
    <div className="flex flex-col gap-1">
      {forms.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {forms.map((f) => (
            <SegChip
              key={f.form}
              active={f.form === form}
              onClick={() => onForm(f.form)}
            >
              {formLabel(f.form)}
            </SegChip>
          ))}
        </div>
      )}
      {strengths.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {strengths.map((s) => (
            <SegChip
              key={s}
              active={s === strength}
              onClick={() => onStrength(s)}
            >
              {s}
            </SegChip>
          ))}
        </div>
      )}
    </div>
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
  const big = React.useContext(BigUi);
  return (
    <div className={cn("flex flex-col", big ? "gap-1.5" : "gap-1")}>
      <span
        className={cn(
          "font-semibold uppercase tracking-wide text-muted-foreground",
          big ? "text-xs" : "text-[10px]",
        )}
      >
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
  const big = React.useContext(BigUi);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md border font-medium transition-colors",
        big ? "h-9 px-3 text-sm" : "h-6 px-2 text-[11px]",
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
  const big = React.useContext(BigUi);
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
        "rounded-md border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/20",
        big ? "h-9 px-3 text-sm" : "h-7 px-2 text-[11px]",
        className,
      )}
    />
  );
}
