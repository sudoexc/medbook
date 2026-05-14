"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronRightIcon,
  FileTextIcon,
  Loader2Icon,
  SearchIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  flattenList,
  useConclusionsList,
  type ConclusionRow,
} from "../_hooks/use-conclusions-list";

export function ConclusionsList() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";

  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"FINALIZED" | "DRAFT">("FINALIZED");

  const [debounced, setDebounced] = React.useState(query);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const list = useConclusionsList({ query: debounced, status });
  const rows = flattenList(list.data);

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по диагнозу или пациенту…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div className="inline-flex rounded-xl border border-border bg-card p-0.5">
          <TabBtn active={status === "FINALIZED"} onClick={() => setStatus("FINALIZED")}>
            Финализированы
          </TabBtn>
          <TabBtn active={status === "DRAFT"} onClick={() => setStatus("DRAFT")}>
            Черновики
          </TabBtn>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Загружаем…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {status === "FINALIZED"
              ? "Финализированных заключений пока нет."
              : "Черновиков пока нет."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <ConclusionRowItem key={r.id} row={r} locale={locale} />
            ))}
          </ul>
        )}
        <div ref={sentinel} />
        {list.isFetchingNextPage && (
          <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Загружаем ещё…
          </div>
        )}
      </section>
    </div>
  );
}

function TabBtn({
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
        "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ConclusionRowItem({ row, locale }: { row: ConclusionRow; locale: string }) {
  const date = row.finalizedAt ?? row.updatedAt;
  const formatted = new Date(date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li>
      <Link
        href={`/${locale}/doctor/conclusions/${row.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileTextIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {row.patient.fullName}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {row.diagnosisCode ? (
              <>
                <span className="font-mono">{row.diagnosisCode}</span>
                {row.diagnosisName ? ` · ${row.diagnosisName}` : ""}
              </>
            ) : (
              "Без диагноза"
            )}
          </div>
        </div>
        <div className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
          {formatted}
        </div>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
