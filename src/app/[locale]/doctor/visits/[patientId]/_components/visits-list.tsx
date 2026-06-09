"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PrinterIcon,
  UserIcon,
} from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";

const RU_MONTHS_FULL = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_FULL[d.getMonth()] ?? ""}`;
}

function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_FULL[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type VisitRow = {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  type: "consultation" | "repeat";
  doctorName: string;
  doctorSpecialty: string;
  serviceName: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  prescriptions: string[];
  advice: string[];
  hasVisitNote: boolean;
  visitNoteId: string | null;
};

type Response = {
  rows: VisitRow[];
  nextCursor: string | null;
  total: number;
};

const TYPE_BADGE: Record<VisitRow["type"], string> = {
  consultation: "bg-success/15 text-success",
  repeat: "bg-violet/15 text-violet",
};

export function VisitsList({
  patientId,
  totalCompleted,
}: {
  patientId: string;
  totalCompleted: number;
}) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const query = useInfiniteQuery<
    Response,
    Error,
    { pages: Response[]; pageParams: (string | undefined)[] },
    [string, string, string],
    string | undefined
  >({
    queryKey: ["doctor", "visits", patientId],
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const url = new URL(
        `/api/crm/doctors/me/patients/${patientId}/visits`,
        window.location.origin,
      );
      url.searchParams.set("limit", "20");
      if (pageParam) url.searchParams.set("cursor", pageParam);
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load visits: ${res.status}`);
      return (await res.json()) as Response;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows: VisitRow[] = [];
  for (const p of query.data?.pages ?? []) rows.push(...p.rows);

  return (
    <>
      <TimelineCard
        rows={rows.slice(0, 8)}
        total={totalCompleted}
        loading={query.isLoading}
      />
      <TableCard
        rows={rows}
        locale={locale}
        patientId={patientId}
        loading={query.isLoading}
        error={query.isError}
        empty={!query.isLoading && rows.length === 0}
        hasMore={query.hasNextPage ?? false}
        fetchingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </>
  );
}

function TimelineCard({
  rows,
  total,
  loading,
}: {
  rows: VisitRow[];
  total: number;
  loading: boolean;
}) {
  const t = useTranslations("doctor.visits");
  // Reverse to render chronologically left → right (oldest first).
  const points = [...rows].reverse();
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const scrollBy = (delta: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-4 text-[15px] font-semibold text-foreground">
        {t("timeline.title")}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={t("timeline.scrollBack")}
          onClick={() => scrollBy(-300)}
          disabled={points.length === 0}
          className="motion-press flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        <div
          ref={scrollerRef}
          className="relative min-w-0 flex-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            aria-hidden
            className="absolute left-0 right-0 top-2 h-px bg-border"
          />
          {loading ? (
            <div className="py-2 text-center text-xs text-muted-foreground">
              {t("timeline.loading")}
            </div>
          ) : points.length === 0 ? (
            <div className="py-2 text-center text-xs text-muted-foreground">
              {t("timeline.empty")}
            </div>
          ) : (
            <ul className="relative grid auto-cols-fr grid-flow-col">
              {points.map((p, i) => {
                const isLatest = i === points.length - 1;
                return (
                  <li
                    key={p.id}
                    className="flex flex-col items-center text-center"
                  >
                    <div className="relative z-10 mb-3 flex h-4 items-center justify-center">
                      <span
                        aria-hidden
                        className={cn(
                          "block rounded-full",
                          isLatest
                            ? "size-4 bg-success ring-4 ring-success/20"
                            : "size-3 bg-primary",
                        )}
                      />
                    </div>
                    <div className="text-sm font-semibold text-foreground tabular-nums">
                      {shortDate(p.date)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t(`type.${p.type}`)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.doctorName.split(" ")[0] ?? ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          aria-label={t("timeline.scrollForward")}
          onClick={() => scrollBy(300)}
          disabled={points.length === 0}
          className="motion-press flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        <div className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-1">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t("timeline.visitCount", { count: total })}
          </span>
        </div>
      </div>
    </section>
  );
}

function TableCard({
  rows,
  locale,
  patientId,
  loading,
  error,
  empty,
  hasMore,
  fetchingMore,
  onLoadMore,
}: {
  rows: VisitRow[];
  locale: string;
  patientId: string;
  loading: boolean;
  error: boolean;
  empty: boolean;
  hasMore: boolean;
  fetchingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations("doctor.visits");
  const router = useRouter();
  // After dropping the «Сравнить» column the action cell is narrower.
  const GRID =
    "grid grid-cols-[120px_130px_minmax(0,200px)_minmax(0,1fr)_170px_150px_160px] gap-3";

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={cn(
          GRID,
          "border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div className="flex items-center gap-1">
          {t("table.dateTime")}
          <ArrowDownIcon className="size-3" />
        </div>
        <div>{t("table.appointmentType")}</div>
        <div>{t("table.diagnosis")}</div>
        <div>{t("table.treatment")}</div>
        <div>{t("table.documents")}</div>
        <div>{t("table.doctor")}</div>
        <div className="text-right">{t("table.actions")}</div>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {t("table.loading")}
        </div>
      ) : error ? (
        <div className="px-5 py-10 text-center text-sm text-destructive">
          {t("table.error")}
        </div>
      ) : empty ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {t("table.empty")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((v) => {
            const treatments = [...v.prescriptions, ...v.advice].slice(0, 4);
            return (
              <li
                key={v.id}
                className={cn(
                  GRID,
                  "items-start px-5 py-4 transition-colors hover:bg-muted/30",
                )}
              >
                <div>
                  <div className="text-sm font-semibold text-foreground tabular-nums">
                    {longDate(v.date)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {hhmm(v.date)} – {hhmm(v.endDate)}
                  </div>
                </div>

                <div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold",
                      TYPE_BADGE[v.type],
                    )}
                  >
                    {t(`type.${v.type}`)}
                  </span>
                </div>

                <div className="flex items-start gap-1.5">
                  <div className="min-w-0">
                    {v.diagnosisCode || v.diagnosisName ? (
                      <>
                        {v.diagnosisCode ? (
                          <div className="text-xs font-semibold text-foreground tabular-nums">
                            {v.diagnosisCode}
                          </div>
                        ) : null}
                        <div className="text-xs text-muted-foreground">
                          {v.diagnosisName ?? ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {t("table.diagnosisNotSpecified")}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={t("table.diagnosisInfo")}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <InfoIcon className="size-3.5" />
                  </button>
                </div>

                <ul className="min-w-0 space-y-0.5 text-xs text-foreground">
                  {treatments.length > 0 ? (
                    treatments.map((t, i) => (
                      <li key={i} className="truncate">
                        {t}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">—</li>
                  )}
                </ul>

                <div>
                  {v.hasVisitNote ? (
                    <Link
                      href={`/${locale}/doctor/visits/${patientId}/${v.id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
                    >
                      <FileTextIcon className="size-4 text-info" />
                      <div className="text-left">
                        <div className="text-[10px] uppercase text-muted-foreground">
                          {t("table.conclusion")}
                        </div>
                        <div className="font-medium text-foreground tabular-nums">
                          {v.visitNoteId?.slice(-6).toUpperCase() ?? ""}
                        </div>
                      </div>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("table.noConclusion")}
                    </span>
                  )}
                </div>

                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {v.doctorName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.doctorSpecialty}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <Link
                    href={`/${locale}/doctor/visits/${patientId}/${v.id}`}
                    className="motion-press inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t("actions.open")}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("actions.moreActions")}
                        className="flex h-9 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <MoreVerticalIcon className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(
                            `/${locale}/doctor/visits/${patientId}/${v.id}`,
                          )
                        }
                      >
                        <ExternalLinkIcon className="mr-2 size-3.5" />
                        {t("menu.openVisit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(v.id);
                            toast.success(t("menu.idCopied"));
                          } catch {
                            toast.error(t("menu.copyFailed"));
                          }
                        }}
                      >
                        <CopyIcon className="mr-2 size-3.5" />
                        {t("menu.copyVisitId")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(`/${locale}/doctor/patients/${patientId}`)
                        }
                      >
                        <UserIcon className="mr-2 size-3.5" />
                        {t("menu.openPatientCard")}
                      </DropdownMenuItem>
                      {v.visitNoteId ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                `/api/crm/visit-notes/${v.visitNoteId}/print`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <PrinterIcon className="mr-2 size-3.5" />
                            {t("menu.printConclusion")}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <footer className="border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={fetchingMore}
            className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
          >
            {fetchingMore ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : null}
            {t("table.loadMore")}
          </button>
        </footer>
      ) : null}
    </section>
  );
}
