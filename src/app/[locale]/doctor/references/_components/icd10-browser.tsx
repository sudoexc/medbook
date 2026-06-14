"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDownIcon,
  CopyIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { ICD10_ENTRIES, type Icd10Entry } from "@/server/icd10/data";

import { useDebounced } from "../_hooks/use-debounced";
import { useIcd10Search } from "../_hooks/use-icd10-search";
import { Highlight } from "./highlight";
import {
  ICD10_CHAPTERS,
  chapterIdFor,
  groupByChapter,
} from "./icd10-chapters";

const SEARCH_DEBOUNCE_MS = 200;

async function copyDiagnosis(
  entry: Icd10Entry,
  messages: { copied: string; copyFailed: string },
) {
  const text = `${entry.code} — ${entry.nameRu}`;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.copied, { description: text });
  } catch {
    toast.error(messages.copyFailed);
  }
}

function Row({
  entry,
  term,
}: {
  entry: Icd10Entry;
  term: string;
}) {
  const t = useTranslations("doctor.references");
  return (
    <button
      type="button"
      onClick={() =>
        copyDiagnosis(entry, {
          copied: t("icd10.copied"),
          copyFailed: t("icd10.copyFailed"),
        })
      }
      className="motion-press group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
    >
      <span className="w-16 shrink-0 text-xs font-semibold text-foreground tabular-nums">
        <Highlight text={entry.code} term={term} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        <Highlight text={entry.nameRu} term={term} />
      </span>
      <CopyIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function Icd10Browser() {
  const t = useTranslations("doctor.references");
  const [q, setQ] = React.useState("");
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const searching = debouncedQ.trim().length >= 2;
  const { data, isFetching, isError } = useIcd10Search(debouncedQ);

  // Default: open the chapter that contains the most entries so the page
  // doesn't look empty on first load. Recomputed once.
  const [openChapters, setOpenChapters] = React.useState<Set<string>>(() => {
    const grouped = groupByChapter(ICD10_ENTRIES);
    let biggestId: string | null = null;
    let biggestCount = 0;
    for (const [id, list] of grouped) {
      if (list.length > biggestCount) {
        biggestCount = list.length;
        biggestId = id;
      }
    }
    return new Set(biggestId ? [biggestId] : []);
  });

  const grouped = React.useMemo(() => groupByChapter(ICD10_ENTRIES), []);

  const toggleChapter = (id: string) => {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          placeholder={t("icd10.searchPlaceholder")}
          className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        {q ? (
          <button
            type="button"
            aria-label={t("icd10.clear")}
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>

      {searching ? (
        <section className="rounded-2xl border border-border bg-card px-3 py-3">
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
            <span>
              {isFetching ? (
                <>
                  <Loader2Icon className="mr-1.5 inline size-3 animate-spin" />
                  {t("icd10.searching")}
                </>
              ) : isError ? (
                <span className="text-destructive">{t("icd10.searchError")}</span>
              ) : (
                <>{t("icd10.foundCount", { count: data?.length ?? 0 })}</>
              )}
            </span>
            <span>{t("icd10.clickToCopy")}</span>
          </div>
          {!isFetching && !isError && (data?.length ?? 0) === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("icd10.emptyQuery", { query: debouncedQ })}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {(data ?? []).map((e) => (
                <li key={e.code}>
                  <Row entry={e} term={debouncedQ.trim()} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="space-y-3">
          {ICD10_CHAPTERS.map((ch) => {
            const entries = grouped.get(ch.id) ?? [];
            if (entries.length === 0) return null;
            const isOpen = openChapters.has(ch.id);
            return (
              <section
                key={ch.id}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggleChapter(ch.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                    {ch.range}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {t(`icd10.chapters.${ch.id}`)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {entries.length}
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
                    {entries.map((e) => (
                      <li key={e.code}>
                        <Row entry={e} term="" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {/* If a code in data.ts ever falls outside known chapters, surface
              it instead of swallowing — easier to spot a missing chapter. */}
          {(() => {
            const unmapped = ICD10_ENTRIES.filter(
              (e) => chapterIdFor(e.code) === null,
            );
            if (unmapped.length === 0) return null;
            return (
              <section className="rounded-2xl border border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning">
                {t("icd10.unmapped", { count: unmapped.length })}
              </section>
            );
          })()}
        </div>
      )}
    </div>
  );
}
