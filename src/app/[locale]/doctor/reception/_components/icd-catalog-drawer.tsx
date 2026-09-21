"use client";

/**
 * ICD-10 catalog drawer — the diagnosis twin of the drug CatalogDrawer.
 *
 * The doctor asked for the same flow prescriptions have: browse a real
 * catalog, not just type-ahead, and star the diagnoses they use daily.
 * Left rail = the 21 standard ICD-10 chapters (reference data, not ours);
 * right pane = the chapter's codes or ranked search results; the star pins
 * a code to DoctorFavorite (entityType ICD10), and favourites float first.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";

/** The 21 ICD-10 chapters — standard reference ranges. */
export const ICD_CHAPTERS: { range: string; ru: string }[] = [
  { range: "A00-B99", ru: "Инфекционные и паразитарные болезни" },
  { range: "C00-D48", ru: "Новообразования" },
  { range: "D50-D89", ru: "Болезни крови и иммунные нарушения" },
  { range: "E00-E90", ru: "Эндокринные болезни, обмен веществ" },
  { range: "F00-F99", ru: "Психические расстройства" },
  { range: "G00-G99", ru: "Болезни нервной системы" },
  { range: "H00-H59", ru: "Болезни глаза" },
  { range: "H60-H95", ru: "Болезни уха" },
  { range: "I00-I99", ru: "Болезни системы кровообращения" },
  { range: "J00-J99", ru: "Болезни органов дыхания" },
  { range: "K00-K93", ru: "Болезни органов пищеварения" },
  { range: "L00-L99", ru: "Болезни кожи" },
  { range: "M00-M99", ru: "Костно-мышечная система" },
  { range: "N00-N99", ru: "Мочеполовая система" },
  { range: "O00-O99", ru: "Беременность и роды" },
  { range: "P00-P96", ru: "Перинатальный период" },
  { range: "Q00-Q99", ru: "Врождённые аномалии" },
  { range: "R00-R99", ru: "Симптомы и отклонения" },
  { range: "S00-T98", ru: "Травмы и отравления" },
  { range: "V01-Y98", ru: "Внешние причины" },
  { range: "Z00-Z99", ru: "Факторы здоровья" },
];

type IcdRow = { code: string; nameRu: string; custom?: boolean };

const PAGE = 100;

async function fetchIcd(params: string): Promise<{ rows: IcdRow[]; total?: number }> {
  const res = await fetch(`/api/crm/icd10/search?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`ICD ${res.status}`);
  return (await res.json()) as { rows: IcdRow[]; total?: number };
}

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onPick: (code: string, name: string) => void;
};

export function IcdCatalogDrawer({ open, onOpenChange, onPick }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const [query, setQuery] = React.useState("");
  const [chapter, setChapter] = React.useState<string>("G00-G99");
  const [pages, setPages] = React.useState(1);
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  const { pinned, toggle } = useDoctorFavorites("ICD10");

  const searching = query.trim().length >= 2;

  const listQuery = useQuery({
    queryKey: ["icd-catalog", searching ? `q:${query}` : `r:${chapter}`, pages],
    queryFn: () =>
      searching
        ? fetchIcd(`q=${encodeURIComponent(query)}&limit=50`)
        : fetchIcd(`range=${chapter}&limit=${PAGE * pages}`),
    enabled: open,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  // Favourites resolve — chips/rows need wording for stored codes.
  const favCodes = React.useMemo(() => [...pinned].sort(), [pinned]);
  const favQuery = useQuery({
    queryKey: ["icd-favorites-resolve", favCodes.join(",")],
    queryFn: () => fetchIcd(`codes=${encodeURIComponent(favCodes.join(","))}`),
    enabled: open && favoritesOnly && favCodes.length > 0,
    staleTime: 5 * 60_000,
  });

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setPages(1);
      setFavoritesOnly(false);
    }
  }, [open]);

  React.useEffect(() => {
    setPages(1);
  }, [chapter, query]);

  const baseRows = favoritesOnly
    ? favQuery.data?.rows ?? []
    : listQuery.data?.rows ?? [];
  // Favourites float to the top of chapter/search lists.
  const rows = React.useMemo(() => {
    if (favoritesOnly || pinned.size === 0) return baseRows;
    const pin: IcdRow[] = [];
    const rest: IcdRow[] = [];
    for (const r of baseRows) (pinned.has(r.code) ? pin : rest).push(r);
    return [...pin, ...rest];
  }, [baseRows, pinned, favoritesOnly]);

  const total = listQuery.data?.total ?? null;
  const canLoadMore =
    !searching && !favoritesOnly && total != null && rows.length < total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("icdCatalog.title")}</DialogTitle>
          <DialogDescription>{t("icdCatalog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex h-[600px] max-h-[80vh] flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("icdCatalog.searchPlaceholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              title={
                favoritesOnly
                  ? t("catalog.showAll")
                  : t("catalog.favoritesOnly")
              }
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
            {/* Chapters rail — hidden while a search narrows globally. */}
            {!searching && !favoritesOnly && (
              <div className="w-[240px] shrink-0 overflow-y-auto border-r p-1">
                {ICD_CHAPTERS.map((c) => (
                  <button
                    key={c.range}
                    type="button"
                    onClick={() => setChapter(c.range)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                      chapter === c.range ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="block font-mono text-[11px] font-semibold text-primary">
                      {c.range}
                    </span>
                    <span className="block text-xs leading-snug text-foreground/80">
                      {c.ru}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Codes */}
            <div className="flex-1 overflow-y-auto">
              {listQuery.isLoading && rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {favoritesOnly
                    ? t("icdCatalog.noFavorites")
                    : t("catalog.notFound")}
                </div>
              ) : (
                <ul className="p-1">
                  {rows.map((r) => {
                    const isPinned = pinned.has(r.code);
                    return (
                      <li key={`${r.code}|${r.nameRu}`} className="group relative">
                        <button
                          type="button"
                          onClick={() => onPick(r.code, r.nameRu)}
                          className="w-full rounded-md px-2 py-1.5 pr-16 text-left transition-colors hover:bg-primary/5"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="shrink-0 font-mono text-sm font-semibold text-primary">
                              {r.code}
                            </span>
                            <span className="min-w-0 text-sm leading-snug text-foreground">
                              {r.nameRu}
                            </span>
                          </span>
                        </button>
                        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => toggle(r.code)}
                            title={
                              isPinned
                                ? t("favorites.remove")
                                : t("favorites.add")
                            }
                            className={cn(
                              "inline-flex size-6 items-center justify-center rounded-md transition-colors",
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
                          <button
                            type="button"
                            onClick={() => onPick(r.code, r.nameRu)}
                            title={t("icdCatalog.pick")}
                            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-colors hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                  {canLoadMore && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setPages((p) => p + 1)}
                        className="w-full rounded-md px-2 py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                      >
                        {t("icdCatalog.loadMore", {
                          shown: rows.length,
                          total: total ?? 0,
                        })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
