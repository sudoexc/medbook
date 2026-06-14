"use client";

/**
 * Phase G1 — drug catalog drawer.
 *
 * Opens as a side panel from the prescriptions field. Search hits
 * `GET /api/crm/catalogs/drugs?q=`; clicking a result reveals a detail
 * panel with forms, indications, contraindications, side effects,
 * pregnancy category, and a one-click "insert into prescriptions" action.
 * Ф2 — the pick hands the full drug record to the caller, which builds a
 * structured VisitPrescription row (form/strength/instruction auto-filled).
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

import {
  DrugDetailView,
  useCategoryLabel,
  type DrugDetail,
} from "../../_components/drug-detail";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";

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
   * VisitPrescription draft from the full drug record (forms/defaultDosing).
   */
  onPick: (drug: DrugDetail) => void;
};

export function CatalogDrawer({ open, onOpenChange, onPick }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const categoryLabel = useCategoryLabel();
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
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

  // Auto-select first result when results refresh.
  React.useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const handlePick = (drug: DrugDetail) => {
    onPick(drug);
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
              onChange={(e) => setQuery(e.target.value)}
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
            <div className="w-1/2 overflow-y-auto border-r">
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
                          onClick={() => setSelectedId(d.id)}
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
                              <span className="truncate">{d.nameRu}</span>
                            </span>
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {categoryLabel(d.category)}
                            </span>
                          </div>
                          {d.brands.length > 0 ? (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {d.brands.map((b) => b.name).join(", ")}
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
            <div className="flex w-1/2 flex-col overflow-y-auto">
              {selected ? (
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
