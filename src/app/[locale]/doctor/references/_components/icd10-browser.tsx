"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  CopyIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebounced } from "@/hooks/use-debounced";
import { toast } from "@/components/ui/sonner";
import {
  DEFAULT_ICD10_CHAPTER,
  ICD10_CHAPTERS,
} from "@/lib/icd10-chapters";

import { useIcd10Search } from "../_hooks/use-icd10-search";
import { Highlight } from "./highlight";

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Codes per request when a chapter is browsed: the most the catalog API
 * hands out at once. «Показать ещё» fetches the next page.
 */
const CHAPTER_PAGE = 200;

type Entry = { code: string; nameRu: string };

type ChapterPage = { rows: Entry[]; total: number };

async function fetchChapter(
  id: string,
  offset: number,
  signal: AbortSignal,
): Promise<ChapterPage> {
  const params = new URLSearchParams({
    range: id,
    offset: String(offset),
    limit: String(CHAPTER_PAGE),
  });
  const res = await fetch(`/api/crm/icd10/search?${params.toString()}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`icd10 chapter: ${res.status}`);
  return (await res.json()) as ChapterPage;
}

async function copyDiagnosis(
  entry: Entry,
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
  entry: Entry;
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

/**
 * The codes of one open chapter, a page at a time. The catalog stays on the
 * server (audit CT-11): importing it here shipped all 1.4 MB of it to every
 * doctor's browser, and opening the biggest chapter rendered 1278 rows at
 * once on the clinic's slow PCs.
 */
function ChapterCodes({ id }: { id: string }) {
  const t = useTranslations("doctor.references");
  const query = useInfiniteQuery({
    queryKey: ["doctor", "references", "icd10", "chapter", id],
    queryFn: ({ pageParam, signal }) => fetchChapter(id, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const shown = pages.reduce((n, p) => n + p.rows.length, 0);
      return last.rows.length > 0 && shown < last.total ? shown : undefined;
    },
    // Reference data: it changes with a deploy, not during a shift.
    staleTime: 60 * 60_000,
  });

  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = query.data?.pages.at(-1)?.total ?? 0;

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-5 py-4 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        {t("icd10.chapterLoading")}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="border-t border-border px-5 py-4 text-xs text-destructive">
        {t("icd10.chapterError")}
      </div>
    );
  }
  return (
    <ul className="space-y-0.5 border-t border-border bg-muted/10 px-2 py-2">
      {rows.map((e) => (
        <li key={e.code}>
          <Row entry={e} term="" />
        </li>
      ))}
      {query.hasNextPage ? (
        <li>
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
          >
            {query.isFetchingNextPage ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : null}
            {t("icd10.loadMore", { shown: rows.length, total })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

export function Icd10Browser({
  chapterCounts,
}: {
  /** Codes per chapter id, counted on the server. */
  chapterCounts: Record<string, number>;
}) {
  const t = useTranslations("doctor.references");
  const [q, setQ] = React.useState("");
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const searching = debouncedQ.trim().length >= 2;
  const { data, isFetching, isError } = useIcd10Search(debouncedQ);

  // The neurologist's own chapter opens first; it used to be the biggest
  // one (injuries), which is noise here.
  const [openChapters, setOpenChapters] = React.useState<Set<string>>(
    () => new Set([DEFAULT_ICD10_CHAPTER]),
  );

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
              {/* Search mixes in the clinic's learned wordings, which may
                  have no code: the code alone is not a unique key. */}
              {(data ?? []).map((e) => (
                <li key={`${e.code}|${e.nameRu}`}>
                  <Row entry={e} term={debouncedQ.trim()} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="space-y-3">
          {ICD10_CHAPTERS.map((ch) => {
            const count = chapterCounts[ch.id] ?? 0;
            if (count === 0) return null;
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
                    {ch.id}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {t(`icd10.chapters.${ch.id}`)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {count}
                  </span>
                  <ChevronDownIcon
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen ? <ChapterCodes id={ch.id} /> : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
