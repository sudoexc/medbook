"use client";

/**
 * The clinic's drug formulary.
 *
 * After the state-register import this holds ~2.7k drugs, which changes what
 * the screen has to be: a flat alphabetical list with a «показать ещё»
 * button is unusable at that size. The layout follows how a doctor actually
 * reaches for a drug:
 *   - a rail of ATC anatomical groups (the WHO classification the register
 *     ships for ~94% of rows) with live counts — the formulary equivalent of
 *     the ICD chapter list;
 *   - «Избранное» and «Часто назначаю», because any one doctor's working set
 *     is a few dozen drugs, not three thousand;
 *   - server-side search across name / INN / brand, ranked;
 *   - filters that answer real questions: Rx vs OTC and «есть инструкция»
 *     (the curated core carries dosing copy, register rows do not);
 *   - the list streams as you scroll instead of asking for permission.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ClockIcon,
  FilterIcon,
  Loader2Icon,
  PillIcon,
  RotateCwIcon,
  SearchIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebounced } from "@/hooks/use-debounced";
import { ATC_GROUPS } from "@/lib/catalogs/atc-groups";
import { matchedBrand } from "@/lib/catalogs/brand-match";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useDoctorFavorites } from "../../reception/_hooks/use-doctor-favorites";
import { useFrequentDrugs } from "../../reception/_hooks/use-frequent-drugs";
import {
  useDrugCatalog,
  useDrugFacets,
  type DrugQuery,
} from "../_hooks/use-drug-catalog";
import {
  DrugDetailView,
  PREGNANCY_TONE,
  RxBadge,
  useCategoryLabel,
  type DrugDetail,
} from "../../_components/drug-detail";
import { Highlight } from "./highlight";
import { DrugPhotoUpload } from "./drug-photo-upload";
import { DrugSimilar } from "./drug-similar";

const SEARCH_DEBOUNCE_MS = 200;

/** Which working set the list is showing. */
type View = "all" | "favorites" | "frequent";

export function DrugBrowser() {
  const t = useTranslations("doctor.references");
  const locale = useLocale();
  const categoryLabel = useCategoryLabel();

  const [q, setQ] = React.useState("");
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const term = debouncedQ.trim();
  const searching = term.length >= 2;

  const [view, setView] = React.useState<View>("all");
  const [atc, setAtc] = React.useState<string | null>(null);
  const [rx, setRx] = React.useState<"rx" | "otc" | null>(null);
  const [withDosing, setWithDosing] = React.useState(false);
  // Fill-in mode: show only what still has no pack photo, so a session of
  // photographing boxes has an obvious worklist and an obvious end.
  const [noPhoto, setNoPhoto] = React.useState(false);
  const [selected, setSelected] = React.useState<DrugDetail | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // «/» jumps to search from anywhere on the page — the formulary is used by
  // someone already typing, and reaching for the mouse breaks that.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const facets = useDrugFacets();
  const { pinned, toggle } = useDoctorFavorites("DRUG");
  const frequent = useFrequentDrugs(30);

  // Favourites and «часто назначаю» are id sets resolved through the same
  // paged endpoint, so every view shares one rendering path.
  const favoriteIds = React.useMemo(() => [...pinned], [pinned]);
  const frequentIds = React.useMemo(
    () =>
      (frequent.data ?? [])
        .map((r) => r.drugId)
        .filter((id): id is string => Boolean(id)),
    [frequent.data],
  );

  const query: DrugQuery = {
    term,
    // A search is global on purpose: the doctor who types a name wants it
    // found, not filtered away by a rail they forgot was active.
    atc: searching ? null : atc,
    rx,
    withDosing,
    noPhoto,
    ids:
      view === "favorites"
        ? favoriteIds
        : view === "frequent"
          ? frequentIds
          : null,
  };

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDrugCatalog(query);

  const rows = React.useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.rows),
    [data],
  );
  const total = data?.pages?.[0]?.total ?? 0;

  // Stream the next page when the sentinel scrolls into view — no button.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resetFilters = () => {
    setAtc(null);
    setRx(null);
    setWithDosing(false);
    setNoPhoto(false);
  };
  const filtersActive =
    atc !== null || rx !== null || withDosing || noPhoto;

  const emptyIdView =
    (view === "favorites" && favoriteIds.length === 0) ||
    (view === "frequent" && frequentIds.length === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears without leaving the field — faster than
              // selecting the text to retype a different drug.
              if (e.key === "Escape" && q) {
                e.preventDefault();
                setQ("");
              }
            }}
            placeholder={t("drugs.searchPlaceholder")}
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label={t("drugs.clear")}
              className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <ViewTab
            active={view === "all"}
            onClick={() => setView("all")}
            label={t("drugs.viewAll")}
            count={facets.data?.total}
          />
          <ViewTab
            active={view === "favorites"}
            onClick={() => setView("favorites")}
            label={t("drugs.viewFavorites")}
            count={favoriteIds.length}
            icon={<StarIcon className="size-3.5" />}
          />
          <ViewTab
            active={view === "frequent"}
            onClick={() => setView("frequent")}
            label={t("drugs.viewFrequent")}
            count={frequentIds.length}
            icon={<ClockIcon className="size-3.5" />}
          />

          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

          <FilterChip
            active={rx === "rx"}
            onClick={() => setRx(rx === "rx" ? null : "rx")}
            label={t("drugs.filterRx")}
          />
          <FilterChip
            active={rx === "otc"}
            onClick={() => setRx(rx === "otc" ? null : "otc")}
            label={t("drugs.filterOtc")}
          />
          <FilterChip
            active={withDosing}
            onClick={() => setWithDosing((v) => !v)}
            label={t("drugs.filterDosing")}
            count={facets.data?.dosingCount}
          />
          <FilterChip
            active={noPhoto}
            onClick={() => setNoPhoto((v) => !v)}
            label={t("drugs.filterNoPhoto")}
          />

          {filtersActive ? (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3" />
              {t("drugs.resetFilters")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* ATC rail — hidden while searching (search is global) and on the
            id-driven views, where a group filter would only confuse. */}
        {!searching && view === "all" ? (
          <nav className="shrink-0 lg:w-[260px]">
            <div className="rounded-2xl border border-border bg-card p-1.5">
              <AtcItem
                active={atc === null}
                onClick={() => setAtc(null)}
                code=""
                label={t("drugs.atcAll")}
                count={facets.data?.total}
              />
              {ATC_GROUPS.map((g) => {
                const count = facets.data?.byGroup?.[g.code] ?? 0;
                if (facets.data && count === 0) return null;
                return (
                  <AtcItem
                    key={g.code}
                    active={atc === g.code}
                    onClick={() => setAtc(atc === g.code ? null : g.code)}
                    code={g.code}
                    label={locale === "uz" ? g.uz : g.ru}
                    count={count}
                  />
                );
              })}
            </div>
          </nav>
        ) : null}

        <div className="min-w-0 flex-1">
          {isError ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-3 py-12 text-center">
              <TriangleAlertIcon className="size-6 text-destructive" />
              <p className="text-sm text-destructive">{t("drugs.loadError")}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="motion-press inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RotateCwIcon
                  className={cn("size-3.5", isFetching && "animate-spin")}
                />
                {t("drugs.retry")}
              </button>
            </div>
          ) : emptyIdView ? (
            <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {view === "favorites"
                  ? t("drugs.favoritesEmpty")
                  : t("drugs.frequentEmpty")}
              </p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-3 py-12">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-3 py-12 text-center text-sm text-muted-foreground">
              {searching
                ? t("drugs.emptyQuery", { query: term })
                : t("drugs.empty")}
            </div>
          ) : (
            <section className="rounded-2xl border border-border bg-card px-2 py-2">
              <div className="mb-1 flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
                <span>
                  {t("drugs.foundOfTotal", { shown: rows.length, total })}
                </span>
                <span className="hidden sm:inline">
                  {t("drugs.clickForDetails")}
                </span>
              </div>
              <ul className="space-y-0.5">
                {rows.map((d) => (
                  <li key={d.id}>
                    <DrugRow
                      drug={d}
                      term={searching ? term : ""}
                      categoryLabel={categoryLabel}
                      pinned={pinned.has(d.id)}
                      onTogglePin={() => toggle(d.id)}
                      onOpen={setSelected}
                      pinLabel={
                        pinned.has(d.id) ? t("drugs.unpin") : t("drugs.pin")
                      }
                    />
                  </li>
                ))}
              </ul>
              {/* Streams the next page on scroll; a spinner is the only
                  thing the doctor ever sees. */}
              <div ref={sentinelRef} className="h-px" />
              {isFetchingNextPage ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PillIcon className="size-4 text-primary" />
              {selected?.nameRu}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("drugs.detailsDescription")}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <>
              <DrugDetailView drug={selected} />
              {/* Substitutions sit right under the facts: «чем заменить» is
                  read many times a day, the photo upload once per drug. */}
              <DrugSimilar
                drugId={selected.id}
                onOpenDrug={(id) => {
                  // Hop to the analogue's own card: look it up among the
                  // loaded rows, otherwise leave the current one open (the
                  // row may be outside the current page/filter).
                  const next = rows.find((r) => r.id === id);
                  if (next) setSelected(next);
                }}
              />
              <DrugPhotoUpload
                drugId={selected.id}
                photoUrl={selected.photoUrl}
                onChanged={(next) =>
                  // Patch the open card immediately; the list refreshes
                  // through its own query invalidation.
                  setSelected((prev) =>
                    prev ? { ...prev, photoUrl: next } : prev,
                  )
                }
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {count !== undefined ? (
        <span className="tabular-nums opacity-70">{count}</span>
      ) : null}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors",
        active
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      <FilterIcon className="size-3" />
      {label}
      {count !== undefined ? (
        <span className="tabular-nums opacity-70">{count}</span>
      ) : null}
    </button>
  );
}

function AtcItem({
  active,
  onClick,
  code,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  code: string;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
      )}
    >
      {code ? (
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {code}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] leading-snug",
          active ? "font-semibold text-primary" : "text-foreground",
        )}
      >
        {label}
      </span>
      {count !== undefined ? (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function DrugRow({
  drug,
  term,
  categoryLabel,
  pinned,
  onTogglePin,
  onOpen,
  pinLabel,
}: {
  drug: DrugDetail;
  term: string;
  categoryLabel: (c: string) => string;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: (d: DrugDetail) => void;
  pinLabel: string;
}) {
  const brandHit = matchedBrand(
    { nameRu: drug.nameRu, brands: drug.brands },
    term,
  );
  const sub: string[] = [];
  // When the row leads with a brand, the substance must be the first thing
  // under it — that is what was actually prescribed.
  if (brandHit) sub.push(drug.nameRu);
  // Register rows carry a synthetic «uzr:» handle — never show it as an INN.
  if (
    drug.inn &&
    !drug.inn.startsWith("uzr:") &&
    drug.inn.toLowerCase() !== drug.nameRu.toLowerCase()
  ) {
    sub.push(drug.inn);
  }
  if (drug.brands.length > 0) {
    sub.push(drug.brands.map((b) => b.name).join(", "));
  }
  const subtext = sub.join(" · ");

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(drug)}
        className="motion-press flex w-full items-center gap-3 rounded-lg py-2 pl-3 pr-10 text-left transition-colors hover:bg-muted/60"
      >
        {drug.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drug.photoUrl}
            alt=""
            className="size-8 shrink-0 rounded-md border border-border bg-white object-contain"
          />
        ) : (
          <PillIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {/* Searching a brand shows the brand — the substance stays in
                the subtext where it belongs. */}
            <Highlight
              text={
                matchedBrand({ nameRu: drug.nameRu, brands: drug.brands }, term) ??
                drug.nameRu
              }
              term={term}
            />
          </span>
          {subtext ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              <Highlight text={subtext} term={term} />
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {drug.atcCode ? (
            <span className="hidden rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
              {drug.atcCode}
            </span>
          ) : null}
          <span className="hidden rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
            {categoryLabel(drug.category)}
          </span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              PREGNANCY_TONE[drug.pregnancyCat],
            )}
          >
            {drug.pregnancyCat}
          </span>
          <RxBadge rxOnly={drug.rxOnly} />
        </span>
      </button>
      <button
        type="button"
        onClick={onTogglePin}
        title={pinLabel}
        aria-label={pinLabel}
        className={cn(
          "absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors",
          pinned
            ? "text-amber-500 hover:bg-amber-100"
            : "text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-amber-500 focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        <StarIcon className={cn("size-4", pinned && "fill-amber-400")} />
      </button>
    </div>
  );
}
