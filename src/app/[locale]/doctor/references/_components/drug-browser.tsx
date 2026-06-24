"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDownIcon,
  Loader2Icon,
  PillIcon,
  RotateCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useDrugCatalog } from "../_hooks/use-drug-catalog";
import {
  DrugDetailView,
  PREGNANCY_TONE,
  RxBadge,
  useCategoryLabel,
  type DrugDetail,
} from "../../_components/drug-detail";
import { Highlight } from "./highlight";

const SEARCH_DEBOUNCE_MS = 150;

// Neuro-first ordering — this is a neurology clinic, so the categories the
// doctor reaches for most sit at the top. Categories present in the data but
// missing here are appended after, so nothing is ever hidden.
const CATEGORY_ORDER = [
  "NEUROLOGICAL",
  "PSYCHIATRIC",
  "ANALGESIC",
  "NSAID",
  "ANTIPYRETIC",
  "ANTISPASMODIC",
  "SEDATIVE",
  "ANTIBIOTIC",
  "ANTIVIRAL",
  "ANTIFUNGAL",
  "ANTIHISTAMINE",
  "CARDIO",
  "DIURETIC",
  "GI",
  "ANTIEMETIC",
  "RESPIRATORY",
  "ENDOCRINE",
  "HORMONAL",
  "STEROID",
  "UROLOGY",
  "GYNECOLOGY",
  "HEMATOLOGY",
  "VITAMIN",
  "DERMATOLOGICAL",
  "TOPICAL",
  "EYE_EAR",
  "OPHTHALMIC",
  "VACCINE",
  "OTHER",
];

function matchesLower(d: DrugDetail, lower: string): boolean {
  return (
    d.nameRu.toLowerCase().includes(lower) ||
    (d.nameUz?.toLowerCase().includes(lower) ?? false) ||
    d.inn.toLowerCase().includes(lower) ||
    d.id.toLowerCase().includes(lower) ||
    d.brands.some((b) => b.name.toLowerCase().includes(lower))
  );
}

function groupByCategory(rows: DrugDetail[]): Map<string, DrugDetail[]> {
  const map = new Map<string, DrugDetail[]>();
  for (const d of rows) {
    const list = map.get(d.category);
    if (list) list.push(d);
    else map.set(d.category, [d]);
  }
  return map;
}

// Order the categories present in `grouped`: known categories first (neuro
// order), then any unknown ones appended alphabetically by enum.
function orderedCategories(grouped: Map<string, DrugDetail[]>): string[] {
  const present = new Set(grouped.keys());
  const known = CATEGORY_ORDER.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
  return [...known, ...extra];
}

function DrugRow({
  drug,
  term,
  showCategory,
  categoryLabel,
  onOpen,
}: {
  drug: DrugDetail;
  term: string;
  showCategory: boolean;
  categoryLabel: (c: string) => string;
  onOpen: (d: DrugDetail) => void;
}) {
  const sub: string[] = [];
  if (drug.inn && drug.inn.toLowerCase() !== drug.nameRu.toLowerCase()) {
    sub.push(drug.inn);
  }
  if (drug.brands.length > 0) {
    sub.push(drug.brands.map((b) => b.name).join(", "));
  }
  const subtext = sub.join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(drug)}
      className="motion-press group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
    >
      <PillIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          <Highlight text={drug.nameRu} term={term} />
        </span>
        {subtext ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            <Highlight text={subtext} term={term} />
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {showCategory ? (
          <span className="hidden rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
            {categoryLabel(drug.category)}
          </span>
        ) : null}
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
  );
}

export function DrugBrowser() {
  const t = useTranslations("doctor.references");
  const categoryLabel = useCategoryLabel();
  const { data, isLoading, isError, refetch, isFetching } = useDrugCatalog();
  const [q, setQ] = React.useState("");
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const term = debouncedQ.trim();
  const searching = term.length >= 2;
  const [selected, setSelected] = React.useState<DrugDetail | null>(null);

  const rows = React.useMemo(() => data ?? [], [data]);
  const grouped = React.useMemo(() => groupByCategory(rows), [rows]);
  const categories = React.useMemo(() => orderedCategories(grouped), [grouped]);

  const filtered = React.useMemo(() => {
    if (!searching) return [];
    const lower = term.toLowerCase();
    return rows.filter((d) => matchesLower(d, lower));
  }, [rows, searching, term]);

  // Open the biggest category by default so first paint isn't a wall of
  // collapsed headers. Recomputed when the data first lands.
  const [openCats, setOpenCats] = React.useState<Set<string>>(new Set());
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || rows.length === 0) return;
    let biggest: string | null = null;
    let max = 0;
    for (const [cat, list] of grouped) {
      if (list.length > max) {
        max = list.length;
        biggest = cat;
      }
    }
    if (biggest) setOpenCats(new Set([biggest]));
    seededRef.current = true;
  }, [rows, grouped]);

  const toggleCat = (cat: string) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("drugs.searchPlaceholder")}
          className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        {q ? (
          <button
            type="button"
            aria-label={t("drugs.clear")}
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-3 py-12 text-sm text-muted-foreground">
          <Loader2Icon className="mr-2 size-4 animate-spin" />
          {t("drugs.loading")}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-12 text-center">
          <TriangleAlertIcon className="size-6 text-destructive" />
          <p className="text-sm text-destructive">{t("drugs.loadError")}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="motion-press inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RotateCwIcon className={cn("size-3.5", isFetching && "animate-spin")} />
            {t("drugs.retry")}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-3 py-12 text-center text-sm text-muted-foreground">
          {t("drugs.empty")}
        </div>
      ) : searching ? (
        <section className="rounded-2xl border border-border bg-card px-3 py-3">
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
            <span>{t("drugs.foundCount", { count: filtered.length })}</span>
            <span>{t("drugs.clickForDetails")}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("drugs.emptyQuery", { query: term })}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((d) => (
                <li key={d.id}>
                  <DrugRow
                    drug={d}
                    term={term}
                    showCategory
                    categoryLabel={categoryLabel}
                    onOpen={setSelected}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const list = grouped.get(cat) ?? [];
            if (list.length === 0) return null;
            const isOpen = openCats.has(cat);
            return (
              <section
                key={cat}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggleCat(cat)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {categoryLabel(cat)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {list.length}
                  </span>
                  <ChevronDownIcon
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen ? (
                  <ul className="space-y-0.5 border-t border-border bg-muted/10 px-2 py-2">
                    {list.map((d) => (
                      <li key={d.id}>
                        <DrugRow
                          drug={d}
                          term=""
                          showCategory={false}
                          categoryLabel={categoryLabel}
                          onOpen={setSelected}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          {selected ? (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>{selected.nameRu}</DialogTitle>
                <DialogDescription>
                  {t("drugs.detailDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[80vh] flex-col overflow-y-auto">
                <DrugDetailView drug={selected} />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
