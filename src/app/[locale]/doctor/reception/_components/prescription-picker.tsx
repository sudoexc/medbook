"use client";

/**
 * The visit screen's prescription picker, mouse first.
 *
 * The clinic's request (03.10.2026): the doctor of this screen works with
 * the mouse, not the keyboard, and the old picker was a search field whose
 * list opened only once he clicked into it. Now three columns are always on
 * screen, every drug one click from the visit with his usual dose and
 * schema:
 *
 *   «Частые»  — what he writes most (counted over his own visits, drafts
 *               included);
 *   «Мои»     — what he starred, and his templates;
 *   «Каталог» — the catalog walked by clicks: the drugs usual for the main
 *               diagnosis, the clinic's core list, then ATC group →
 *               subgroup → drugs.
 *
 * The search stays, as an extra on top: typing swaps the columns for its
 * results until it is cleared. On a narrow card (a phone, a split screen)
 * the three columns become three tabs over one list.
 *
 * Nothing here saves: a click hands the item to the constructor, which runs
 * it through the same «dose first» step as every other pick. Items already
 * on the visit stay in place, marked, so a list never moves under the
 * cursor between two clicks. They stay clickable too: in neurology a course
 * is often written in two forms («Мексидол 5,0 в/м №10», then «Мексидол
 * 125 мг таб»), and a second click adds the drug again. Only the second
 * click of a double click is ignored, so one gesture never adds two rows.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  StethoscopeIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  atcGroupLabel,
  atcSubgroupLabel,
} from "@/lib/catalogs/atc-groups";
import { matchedBrand } from "@/lib/catalogs/brand-match";
import { normalizeForms } from "@/lib/catalogs/drug-forms";
import {
  formatPrescriptionSchedule,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";

import { useDrugFacets } from "../../references/_hooks/use-drug-catalog";
import type { DoctorPresetRow } from "../_hooks/use-doctor-presets";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";
import {
  atcSubgroups,
  catalogRootGroups,
  isRepeatClick,
  onVisitChecker,
  starredColumn,
} from "../_hooks/prescription-columns";
import { shortItemFromDrug } from "../_hooks/prescription-rows";
import { useAtcDrugs } from "../_hooks/use-atc-drugs";
import {
  useDrugSearch,
  useDrugSuggestions,
  type DrugSearchHit,
} from "../_hooks/use-drug-search";
import {
  useDrugShortlist,
  type DrugShortItem,
  type DrugUsual,
} from "../_hooks/use-shortlists";
import type { VisitPrescriptionRow } from "../_hooks/use-visit-note";

type ColumnKey = "frequent" | "mine" | "catalog";

/** Where the «Каталог» column is: its root, a group, or a subgroup's drugs. */
type CatalogPath =
  | { kind: "root" }
  | { kind: "diagnosis" }
  | { kind: "core" }
  | { kind: "atc"; letter: string }
  | { kind: "sub"; letter: string; code: string };

type Props = {
  noteId: string;
  diagnosisCode: string | null;
  rows: readonly VisitPrescriptionRow[];
  legacy: readonly string[];
  presets: DoctorPresetRow[];
  onPresetClick: (preset: DoctorPresetRow) => void;
  /** A column item (his history, a star, the core list, a catalog drug). */
  onPickItem: (item: DrugShortItem) => void;
  /** A search hit, with what was typed: a brand search prescribes the brand. */
  onPickHit: (drug: DrugSearchHit, term: string) => void;
  /** The search found nothing under this name: add it to the clinic's base. */
  onAddToClinicBase: (name: string) => void;
  addingToClinic: boolean;
};

export function PrescriptionPicker({
  noteId,
  diagnosisCode,
  rows,
  legacy,
  presets,
  onPresetClick,
  onPickItem,
  onPickHit,
  onAddToClinicBase,
  addingToClinic,
}: Props) {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";

  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<ColumnKey>("frequent");
  const [path, setPath] = React.useState<CatalogPath>({ kind: "root" });
  // The next patient starts from a clean picker: no half-typed search, the
  // catalog back at its root.
  React.useEffect(() => {
    setQuery("");
    setPath({ kind: "root" });
  }, [noteId]);

  const shortlistQuery = useDrugShortlist(true);
  const shortlist = shortlistQuery.data;
  const usual = shortlist?.usual ?? NO_USUAL;

  const { favorites, pinned, isLoading: favoritesLoading, toggle } =
    useDoctorFavorites("DRUG");
  // Drugs starred in this session from the catalog or the search: the
  // shortlist the server sent does not know them yet, and «Мои» must show
  // them at once.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, DrugSearchHit>>(
    () => new Map(),
  );
  const toggleStar = React.useCallback(
    (item: DrugShortItem) => {
      if (!item.drugId) return;
      if (item.drug) {
        const drug = item.drug;
        setSeen((prev) => new Map(prev).set(drug.id, drug));
      }
      toggle(item.drugId);
    },
    [toggle],
  );

  const onVisit = React.useMemo(() => onVisitChecker(rows, legacy), [rows, legacy]);

  const frequent = shortlist?.frequent ?? NO_ITEMS;
  const core = shortlist?.core ?? NO_ITEMS;
  const mine = React.useMemo(
    () =>
      starredColumn({
        favorites: favoritesLoading ? null : favorites.map((f) => f.entityCode),
        starred: shortlist?.starred ?? NO_ITEMS,
        known: [...frequent, ...core],
        seen,
        usual,
      }),
    [favoritesLoading, favorites, shortlist?.starred, frequent, core, seen, usual],
  );

  const searching = query.trim().length >= 2;

  const itemProps = (item: DrugShortItem) => ({
    item,
    locale,
    starred: item.drugId ? pinned.has(item.drugId) : null,
    added: onVisit(item),
    onPick: () => onPickItem(item),
    onStar: () => toggleStar(item),
  });

  return (
    <div className="@container mt-3 flex flex-col gap-2">
      {/* ── Optional search ── */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("rx.picker.searchPlaceholder")}
          className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("rx.picker.searchClear")}
            title={t("rx.picker.searchClear")}
            className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>

      {searching ? (
        <SearchResults
          query={query}
          locale={locale}
          usual={usual}
          pinned={pinned}
          onVisit={onVisit}
          onPickHit={(hit) => {
            onPickHit(hit, query);
            setQuery("");
          }}
          onStar={toggleStar}
          onAddToClinicBase={() => {
            onAddToClinicBase(query);
            setQuery("");
          }}
          addingToClinic={addingToClinic}
        />
      ) : (
        <>
          {/* Narrow card: one column at a time, picked by these tabs. */}
          <div
            role="tablist"
            className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 @min-[440px]:hidden"
          >
            {(["frequent", "mine", "catalog"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "h-10 rounded-lg text-sm font-semibold transition-colors",
                  tab === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`rx.picker.col.${key}`)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-3">
            <PickerColumn
              title={t("rx.picker.col.frequent")}
              count={frequent.length}
              visible={tab === "frequent"}
            >
              {shortlistQuery.isLoading ? (
                <ColumnNote loading />
              ) : frequent.length === 0 ? (
                <ColumnNote>{t("rx.picker.frequentEmpty")}</ColumnNote>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {frequent.map((item) => (
                    <PickerItemRow key={`f-${item.key}`} {...itemProps(item)} />
                  ))}
                </ul>
              )}
            </PickerColumn>

            <PickerColumn
              title={t("rx.picker.col.mine")}
              count={mine.length}
              visible={tab === "mine"}
            >
              {shortlistQuery.isLoading && mine.length === 0 ? (
                <ColumnNote loading />
              ) : (
                <>
                  {mine.length === 0 ? (
                    <ColumnNote compact={presets.length > 0}>
                      {t("rx.picker.mineEmpty")}
                    </ColumnNote>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {mine.map((item) => (
                        <PickerItemRow key={`m-${item.key}`} {...itemProps(item)} />
                      ))}
                    </ul>
                  )}
                  {presets.length > 0 && (
                    <div className="mt-2 border-t border-border/70 pt-2">
                      <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("rx.picker.templates")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {presets.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onPresetClick(p)}
                            title={
                              p.noteTemplate
                                ? t("structured.presetTitleWithTemplate")
                                : t("structured.presetTitle")
                            }
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                          >
                            {p.noteTemplate && (
                              <WandSparklesIcon className="size-3.5 shrink-0 text-primary/70" />
                            )}
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </PickerColumn>

            <CatalogColumn
              visible={tab === "catalog"}
              path={path}
              onPath={setPath}
              diagnosisCode={diagnosisCode}
              core={core}
              usual={usual}
              locale={locale}
              renderItem={(item, key) => <PickerItemRow key={key} {...itemProps(item)} />}
              pinned={pinned}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Stable empties so the memos above do not recompute while loading.
const NO_ITEMS: DrugShortItem[] = [];
const NO_USUAL: Record<string, DrugUsual> = {};

// ── Columns ───────────────────────────────────────────────────────────

/**
 * One column: a title over a list of fixed height that scrolls on its own,
 * so the three end level and the rows under them never jump as lists load.
 */
function PickerColumn({
  title,
  count,
  visible,
  header,
  scrollKey,
  children,
}: {
  title: string;
  count?: number;
  /** On a narrow card only the active tab's column shows. */
  visible: boolean;
  /** Replaces the plain title (the catalog's back button). */
  header?: React.ReactNode;
  /** A new value scrolls the list back to its top (a new catalog level). */
  scrollKey?: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);
  return (
    <section
      className={cn(
        "min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
        visible ? "flex" : "hidden",
        "@min-[440px]:flex",
      )}
    >
      <div className="flex min-h-11 items-center gap-2 border-b border-border/70 px-3 py-1.5">
        {header ?? (
          <>
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
              {title}
            </h3>
            {count ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </>
        )}
      </div>
      <div ref={listRef} className="h-[22rem] overflow-y-auto p-1">
        {children}
      </div>
    </section>
  );
}

function ColumnNote({
  loading,
  compact,
  children,
}: {
  loading?: boolean;
  /** Something follows it in the column: no need to fill the height. */
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center px-3 text-center text-sm leading-snug text-muted-foreground",
        compact ? "py-6" : "h-full",
      )}
    >
      {loading ? <Loader2Icon className="size-5 animate-spin" /> : children}
    </div>
  );
}

/**
 * One drug: the whole row is the add button, the star in its corner pins it
 * to «Мои». Two sibling buttons, not one inside the other: a click on the
 * star must never add the drug.
 *
 * Laid out for the narrowest case: at 1536px (a 1920 screen at 125%) the
 * middle column is about 490px and each picker column about 145px. The name
 * gets the row's whole width; the star sits over the end of the second
 * line, which is kept free for it.
 */
function PickerItemRow({
  item,
  locale,
  starred,
  added,
  onPick,
  onStar,
}: {
  item: DrugShortItem;
  locale: PrescriptionLocale;
  /** null: this row cannot be starred (a free-typed history line). */
  starred: boolean | null;
  added: boolean;
  onPick: () => void;
  onStar: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const usual = usualLine(item, locale);
  const strengths = item.drug
    ? normalizeForms(item.drug.forms)[0]?.strengths.slice(0, 3).join(" / ")
    : "";
  const sub = usual || strengths || "";
  return (
    <li className="relative">
      <button
        type="button"
        onClick={(e) => {
          if (isRepeatClick(e.detail)) return;
          onPick();
        }}
        title={
          added
            ? t("rx.picker.onVisit")
            : item.count > 0
              ? t("rx.shortCount", { n: item.count })
              : undefined
        }
        className={cn(
          "block min-h-12 w-full rounded-lg px-2 py-1.5 text-left transition-colors",
          added
            ? "bg-success/5 hover:bg-success/10 active:bg-success/15"
            : "hover:bg-primary/5 active:bg-primary/10",
        )}
      >
        <span
          className={cn(
            "block break-words text-[15px] font-medium leading-snug",
            added ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {added ? (
            <CheckIcon className="mr-1 inline size-4 -translate-y-px text-success" />
          ) : null}
          {item.label}
        </span>
        {/* Always there, so the star never covers the name. */}
        <span
          className={cn(
            "mt-0.5 line-clamp-2 min-h-[1.125rem] break-words text-[13px] leading-snug text-muted-foreground",
            starred !== null && "pr-8",
          )}
          title={usual ? t("rx.picker.usualHint") : undefined}
        >
          {sub}
        </span>
      </button>
      {starred !== null ? (
        <button
          type="button"
          onClick={onStar}
          aria-pressed={starred}
          aria-label={starred ? t("rx.picker.starRemove") : t("rx.picker.starAdd")}
          title={starred ? t("rx.picker.starRemove") : t("rx.picker.starAdd")}
          className={cn(
            "absolute bottom-0.5 right-0.5 inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            starred
              ? "text-amber-500 hover:bg-amber-500/10"
              : "text-muted-foreground/50 hover:bg-muted hover:text-amber-500",
          )}
        >
          <StarIcon className={cn("size-4", starred ? "fill-amber-400" : "")} />
        </button>
      ) : null}
    </li>
  );
}

/** His usual dose and schema as one line, empty when he has none. */
function usualLine(item: DrugShortItem, locale: PrescriptionLocale): string {
  if (item.count <= 0 || !item.lastDose) return "";
  return formatPrescriptionSchedule(
    {
      dose: item.lastDose,
      timesOfDay: item.lastTimesOfDay ?? [],
      mealRelation: item.lastMealRelation ?? "NO_MATTER",
      durationDays: item.lastDurationDays ?? null,
    },
    locale,
  );
}

// ── «Каталог» ─────────────────────────────────────────────────────────

function CatalogColumn({
  visible,
  path,
  onPath,
  diagnosisCode,
  core,
  usual,
  locale,
  pinned,
  renderItem,
}: {
  visible: boolean;
  path: CatalogPath;
  onPath: (path: CatalogPath) => void;
  diagnosisCode: string | null;
  core: readonly DrugShortItem[];
  usual: Readonly<Record<string, DrugUsual>>;
  locale: PrescriptionLocale;
  pinned: ReadonlySet<string>;
  renderItem: (item: DrugShortItem, key: string) => React.ReactNode;
}) {
  const t = useTranslations("doctor.reception");
  const facets = useDrugFacets();
  const suggest = useDrugSuggestions(diagnosisCode);
  const subCode = path.kind === "sub" ? path.code : null;
  const atc = useAtcDrugs(subCode);

  // A diagnosis changed under an open «При …» group: back to the root.
  React.useEffect(() => {
    if (path.kind === "diagnosis" && !diagnosisCode) onPath({ kind: "root" });
  }, [path.kind, diagnosisCode, onPath]);

  const asItem = (drug: DrugSearchHit) =>
    shortItemFromDrug(drug, usual[drug.id], { pinned: pinned.has(drug.id) });

  const back = (to: CatalogPath, label: string) => (
    <button
      type="button"
      onClick={() => onPath(to)}
      className="-ml-1.5 inline-flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
    >
      <ChevronLeftIcon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );

  const groupLabel = (letter: string) => atcGroupLabel(letter, locale) ?? letter;
  const subLabel = (code: string) => atcSubgroupLabel(code, locale) ?? code;

  let header: React.ReactNode = null;
  let body: React.ReactNode;

  if (path.kind === "root") {
    const groups = catalogRootGroups({
      diagnosisCode,
      diagnosisCount: suggest.data?.length ?? 0,
      coreCount: core.length,
      byGroup: facets.data?.byGroup,
    });
    body = (
      <ul className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <li key={`${g.kind}-${"code" in g ? g.code : ""}`}>
            <GroupButton
              icon={
                g.kind === "diagnosis" ? (
                  <StethoscopeIcon className="size-4 text-primary" />
                ) : g.kind === "core" ? (
                  <StarIcon className="size-4 text-primary" />
                ) : undefined
              }
              label={
                g.kind === "diagnosis"
                  ? t("rx.picker.groupDiagnosis", { code: g.code })
                  : g.kind === "core"
                    ? t("rx.shortClinic")
                    : groupLabel(g.code)
              }
              meta={groupMeta(g.kind === "atc" ? g.code : null, g.count)}
              onClick={() =>
                onPath(
                  g.kind === "atc"
                    ? { kind: "atc", letter: g.code }
                    : { kind: g.kind },
                )
              }
            />
          </li>
        ))}
      </ul>
    );
  } else if (path.kind === "diagnosis" || path.kind === "core") {
    header = back(
      { kind: "root" },
      path.kind === "diagnosis"
        ? t("rx.picker.groupDiagnosis", { code: diagnosisCode ?? "" })
        : t("rx.shortClinic"),
    );
    const items =
      path.kind === "core"
        ? core
        : (suggest.data ?? []).map((d) => asItem(d));
    body = (
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => renderItem(item, `c-${path.kind}-${item.key}`))}
      </ul>
    );
  } else if (path.kind === "atc") {
    header = back({ kind: "root" }, groupLabel(path.letter));
    const subs = atcSubgroups(path.letter, facets.data?.bySubgroup);
    body = (
      <ul className="flex flex-col gap-0.5">
        {subs.map((s) => (
          <li key={s.code}>
            <GroupButton
              label={subLabel(s.code)}
              meta={groupMeta(s.code, s.count)}
              onClick={() =>
                onPath({ kind: "sub", letter: path.letter, code: s.code })
              }
            />
          </li>
        ))}
      </ul>
    );
  } else {
    header = back({ kind: "atc", letter: path.letter }, subLabel(path.code));
    const drugs = atc.data?.pages.flatMap((p) => p.rows) ?? [];
    body = atc.isLoading ? (
      <ColumnNote loading />
    ) : atc.isError && drugs.length === 0 ? (
      <button
        type="button"
        onClick={() => void atc.refetch()}
        className="flex h-full w-full items-center justify-center px-3 text-center text-sm text-destructive"
      >
        {t("rx.picker.loadError")}
      </button>
    ) : drugs.length === 0 ? (
      <ColumnNote>{t("rx.picker.groupEmpty")}</ColumnNote>
    ) : (
      <>
        <ul className="flex flex-col gap-0.5">
          {drugs.map((d) => renderItem(asItem(d), `a-${d.id}`))}
        </ul>
        {atc.hasNextPage ? (
          <button
            type="button"
            disabled={atc.isFetchingNextPage}
            onClick={() => void atc.fetchNextPage()}
            className="mt-1 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {atc.isFetchingNextPage && <Loader2Icon className="size-4 animate-spin" />}
            {t("rx.picker.showMore")}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <PickerColumn
      title={t("rx.picker.col.catalog")}
      visible={visible}
      header={header}
      scrollKey={JSON.stringify(path)}
    >
      {body}
    </PickerColumn>
  );
}

/** A group of the catalog: its name over its code and size, then a chevron. */
function GroupButton({
  icon,
  label,
  meta,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  /** «N03 · 58»: what the group is in the classification, and how big. */
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/5 active:bg-primary/10"
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[15px] font-medium leading-snug text-foreground">
          {icon ? (
            <span className="mr-1 inline-flex -translate-y-px align-middle">{icon}</span>
          ) : null}
          {label}
        </span>
        {meta ? (
          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** «N03 · 58», «58», «N03»: the parts that are known. */
function groupMeta(code: string | null, count: number | null): string {
  return [code, count != null ? String(count) : null].filter(Boolean).join(" · ");
}

// ── Search results ────────────────────────────────────────────────────

function SearchResults({
  query,
  locale,
  usual,
  pinned,
  onVisit,
  onPickHit,
  onStar,
  onAddToClinicBase,
  addingToClinic,
}: {
  query: string;
  locale: PrescriptionLocale;
  usual: Readonly<Record<string, DrugUsual>>;
  pinned: ReadonlySet<string>;
  onVisit: (item: { drugId: string | null; label: string }) => boolean;
  onPickHit: (hit: DrugSearchHit) => void;
  onStar: (item: DrugShortItem) => void;
  onAddToClinicBase: () => void;
  addingToClinic: boolean;
}) {
  const t = useTranslations("doctor.reception");
  const search = useDrugSearch(query);
  const hits = search.data ?? [];
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex min-h-11 items-center gap-2 border-b border-border/70 px-3 py-1.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {t("rx.picker.results")}
        </h3>
        {search.isFetching && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="max-h-[22rem] min-h-40 overflow-y-auto p-1">
        {/* «Nothing found» only for an answered search: while the typing
            debounce runs there is no answer yet, not an empty one. */}
        {search.data !== undefined && hits.length === 0 && !search.isFetching ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            {t("rx.picker.searchEmpty")}
          </p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {hits.map((hit) => {
            // Lead with what the doctor typed: a brand query shows the brand.
            const label =
              matchedBrand({ nameRu: hit.nameRu, brands: hit.brands }, query) ??
              hit.nameRu;
            const item = shortItemFromDrug(hit, usual[hit.id], {
              label,
              pinned: pinned.has(hit.id),
            });
            return (
              <PickerItemRow
                key={hit.id}
                item={{ ...item, label }}
                locale={locale}
                starred={pinned.has(hit.id)}
                added={onVisit({ drugId: hit.id, label })}
                onPick={() => onPickHit(hit)}
                onStar={() => onStar(item)}
              />
            );
          })}
        </ul>
        {/* Not in the catalog under this name: add it for the whole
            clinic instead of a one-off line nobody else will find. */}
        {!search.isFetching && query.trim().length >= 3 ? (
          <button
            type="button"
            disabled={addingToClinic}
            onClick={onAddToClinicBase}
            className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 text-left text-sm transition-colors hover:bg-primary/5 disabled:opacity-60"
          >
            {addingToClinic ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <PlusIcon className="size-4 shrink-0 text-primary" />
            )}
            <span className="text-foreground">
              {t("rx.addToClinic", { name: query.trim() })}
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
