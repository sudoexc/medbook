"use client";

/**
 * Phase G1 — drug catalog drawer.
 *
 * Opens as a side panel from the prescriptions field. Search hits
 * `GET /api/crm/catalogs/drugs?q=`; clicking a result reveals a detail
 * panel with forms, indications, contraindications, side effects,
 * pregnancy category, and a one-click "insert into prescriptions" action.
 * Ф2 — the pick hands the full drug record to the caller, which builds a
 * structured VisitPrescription row (form/strength auto-filled; the reference
 * dosing stays in this panel for the doctor, see draftFromDrug).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { matchedBrand } from "@/lib/catalogs/brand-match";
import { drawerSelection } from "@/lib/catalogs/drawer-selection";

import {
  DrugDetailView,
  useCategoryLabel,
  type DrugDetail,
} from "../../_components/drug-detail";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";
import { DrugSimilar } from "../../references/_components/drug-similar";

async function fetchDrugs(q: string): Promise<DrugDetail[]> {
  const url = `/api/crm/catalogs/drugs?q=${encodeURIComponent(q)}&limit=60`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Catalog ${res.status}`);
  const data = (await res.json()) as { rows: DrugDetail[] };
  return data.rows ?? [];
}

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Called when the user picks a drug. Ф2 — the caller builds a structured
   * VisitPrescription draft from the full drug record (forms, brands).
   */
  onPick: (drug: DrugDetail, term: string) => void;
};

export function CatalogDrawer({ open, onOpenChange, onPick }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const categoryLabel = useCategoryLabel();
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // A card opened from «Чем заменить». The analogue is usually not among
  // the search results, and it must stay open anyway: falling back to the
  // first result showed a DIFFERENT drug under the doctor's click.
  const [openedAnalogue, setOpenedAnalogue] = React.useState<DrugDetail | null>(
    null,
  );
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  const drugsQuery = useQuery({
    queryKey: ["catalog-drugs", query],
    queryFn: () => fetchDrugs(query),
    enabled: open,
    staleTime: 60_000,
  });

  const { pinned, toggle } = useDoctorFavorites("DRUG");

  // Reset query on close.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedId(null);
      setOpenedAnalogue(null);
      setFavoritesOnly(false);
    }
  }, [open]);

  const rawRows = drugsQuery.data ?? [];
  const filteredRows = favoritesOnly
    ? rawRows.filter((r) => pinned.has(r.id))
    : rawRows;
  // Float pinned favourites to the top so the doctor's go-to picks stay one
  // tap away. Within each bucket we keep the API order (which already ranks
  // by INN match / brand / prefix — see drugs route ranker).
  const rows = React.useMemo(() => {
    if (pinned.size === 0) return filteredRows;
    const pin: typeof filteredRows = [];
    const rest: typeof filteredRows = [];
    for (const r of filteredRows) (pinned.has(r.id) ? pin : rest).push(r);
    return [...pin, ...rest];
  }, [filteredRows, pinned]);

  // The first result when results refresh, unless the doctor is looking at
  // an analogue: that card was chosen, it is not a stale default.
  const { selected, selectedId: settledId } = drawerSelection(
    rows,
    selectedId,
    openedAnalogue,
  );
  React.useEffect(() => {
    if (settledId !== selectedId) setSelectedId(settledId);
  }, [settledId, selectedId]);

  const selectRow = (id: string) => {
    setOpenedAnalogue(null);
    setSelectedId(id);
  };

  const handlePick = (drug: DrugDetail) => {
    // Carry what was typed: a brand search must prescribe the brand. Not for
    // an analogue, though: the search was about another drug, and its text
    // must not pick one of the analogue's brands by accident.
    onPick(drug, rows.some((r) => r.id === drug.id) ? query : "");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("catalog.title")}</DialogTitle>
          <DialogDescription>
            {t("catalog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[600px] max-h-[80vh] flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => {
                // A new search is a new question: the analogue card yields
                // to its results.
                setOpenedAnalogue(null);
                setQuery(e.target.value);
              }}
              placeholder={t("catalog.searchPlaceholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              title={favoritesOnly ? t("catalog.showAll") : t("catalog.favoritesOnly")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors",
                favoritesOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <StarIcon
                className={cn(
                  "size-3.5",
                  favoritesOnly ? "fill-amber-400 text-amber-500" : "",
                )}
              />
              {pinned.size}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("actions.close")}
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* List */}
            {/* min-w-0: a flex child defaults to min-width:auto and cannot
                shrink below its content. The register import gave popular
                molecules 20+ trade names («Найз, Нимесил, НИМЕЛИД, …»), and
                that one line pushed this column wide enough to shove the
                detail pane out of the dialog. Same class of bug as the
                rtxshop gallery strip. */}
            <div className="w-1/2 min-w-0 overflow-y-auto border-r">
              {drugsQuery.isLoading && rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {query.trim()
                    ? t("catalog.notFound")
                    : t("catalog.typeToSearch")}
                </div>
              ) : (
                <ul className="p-1">
                  {rows.map((d) => {
                    const isPinned = pinned.has(d.id);
                    return (
                      <li key={d.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => selectRow(d.id)}
                          className={cn(
                            "w-full rounded-md px-2 py-1.5 pr-8 text-left transition-colors",
                            selectedId === d.id
                              ? "bg-primary/10"
                              : "hover:bg-muted",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-foreground">
                              {isPinned ? (
                                <StarIcon className="size-3 shrink-0 fill-amber-400 text-amber-500" />
                              ) : null}
                              {/* Lead with the brand the query matched. */}
                              <span className="truncate">
                                {matchedBrand(
                                  { nameRu: d.nameRu, brands: d.brands },
                                  query,
                                ) ?? d.nameRu}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {categoryLabel(d.category)}
                            </span>
                          </div>
                          {d.brands.length > 0 ? (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {/* Cap the visible list: a molecule with 25
                                  brands is informative as «first three + N
                                  more», not as an unreadable ribbon. */}
                              {d.brands.slice(0, 3).map((b) => b.name).join(", ")}
                              {d.brands.length > 3
                                ? ` +${d.brands.length - 3}`
                                : ""}
                            </div>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(d.id);
                          }}
                          title={isPinned ? t("favorites.remove") : t("favorites.add")}
                          className={cn(
                            "absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-md transition-colors",
                            isPinned
                              ? "text-amber-500 hover:bg-amber-100"
                              : "text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-amber-500 group-hover:opacity-100",
                          )}
                        >
                          <StarIcon
                            className={cn(
                              "size-3.5",
                              isPinned ? "fill-amber-400" : "",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Detail */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-y-auto">
              {selected ? (
                <>
                  <DrugDetailView
                    drug={selected}
                    footer={
                      <Button
                        onClick={() => handlePick(selected)}
                        className="w-full"
                        size="sm"
                      >
                        <CheckIcon className="mr-1 size-3.5" />
                        {t("catalog.addToPrescriptions")}
                      </Button>
                    }
                  />
                  {/* «Чем заменить» right where the prescribing happens:
                      the patient says the pharmacy had none, the doctor
                      swaps without leaving the visit. */}
                  <DrugSimilar
                    drugId={selected.id}
                    onOpenDrug={(drug) => {
                      setOpenedAnalogue(drug);
                      setSelectedId(drug.id);
                    }}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
                  {t("catalog.selectDrug")}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
