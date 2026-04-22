"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, ArrowUpIcon, UsersIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, formatName, type Locale } from "@/lib/format";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { PhoneText } from "@/components/atoms/phone-text";
import { TagChip } from "@/components/atoms/tag-chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type {
  PatientRow,
  PatientsListFilters,
} from "../_hooks/use-patients-list";

type SegmentColor =
  | "primary"
  | "info"
  | "warning"
  | "success"
  | "violet"
  | "neutral";

const SEGMENT_STYLE: Record<
  PatientRow["segment"],
  { tone: SegmentColor; labelKey: string }
> = {
  NEW: { tone: "primary", labelKey: "segment.new" },
  ACTIVE: { tone: "success", labelKey: "segment.active" },
  VIP: { tone: "violet", labelKey: "segment.vip" },
  DORMANT: { tone: "warning", labelKey: "segment.dormant" },
  CHURN: { tone: "neutral", labelKey: "segment.churn" },
};

function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export interface PatientsTableProps {
  rows: PatientRow[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  hasFilters: boolean;
  onCreate: () => void;
  sort: PatientsListFilters["sort"];
  dir: PatientsListFilters["dir"];
  onSortChange: (
    sort: PatientsListFilters["sort"],
    dir: PatientsListFilters["dir"],
  ) => void;
  total: number | null;
}

export function PatientsTable({
  rows,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  hasFilters,
  onCreate,
  sort,
  dir,
  onSortChange,
  total,
}: PatientsTableProps) {
  const t = useTranslations("patients");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const sorting: SortingState = React.useMemo(
    () => (sort ? [{ id: sort, desc: dir !== "asc" }] : []),
    [sort, dir],
  );

  const handleSortChange = React.useCallback(
    (columnId: PatientsListFilters["sort"]) => {
      const next: PatientsListFilters["sort"] = columnId;
      let nextDir: PatientsListFilters["dir"] = "desc";
      if (sort === columnId) nextDir = dir === "asc" ? "desc" : "asc";
      onSortChange(next, nextDir);
    },
    [sort, dir, onSortChange],
  );

  const columns = React.useMemo<ColumnDef<PatientRow>[]>(
    () => [
      {
        id: "fullName",
        header: () => t("columns.name"),
        cell: ({ row }) => {
          const p = row.original;
          const age = ageFrom(p.birthDate);
          const parts = p.fullName.trim().split(/\s+/);
          const [last, first, patronymic] = parts;
          const display = formatName(first, last, patronymic, "full") || p.fullName;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <AvatarWithStatus
                src={p.photoUrl ?? undefined}
                name={p.fullName}
                size="sm"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {display}
                  {age !== null ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      · {age}
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  <PhoneText phone={p.phone} asText />
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "segment",
        header: () => t("columns.segment"),
        cell: ({ row }) => {
          const cfg = SEGMENT_STYLE[row.original.segment];
          return (
            <TagChip
              color={cfg.tone}
              label={t(cfg.labelKey as never)}
            />
          );
        },
      },
      {
        id: "ltv",
        header: () => t("columns.ltv"),
        cell: ({ row }) => (
          <MoneyText
            amount={row.original.ltv}
            currency="UZS"
            className="text-sm font-medium"
          />
        ),
      },
      {
        id: "lastVisitAt",
        header: () => t("columns.lastVisit"),
        cell: ({ row }) => {
          const v = row.original.lastVisitAt;
          if (!v)
            return (
              <span className="text-xs text-muted-foreground">—</span>
            );
          return (
            <span className="text-sm text-foreground">
              {formatDate(v, locale, "relative")}
            </span>
          );
        },
      },
      {
        id: "tags",
        header: () => t("columns.tags"),
        cell: ({ row }) => {
          const tags = row.original.tags.slice(0, 3);
          if (tags.length === 0)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <TagChip key={tag} label={tag} color="info" />
              ))}
              {row.original.tags.length > 3 ? (
                <span className="text-xs text-muted-foreground">
                  +{row.original.tags.length - 3}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [t, locale],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  // Virtualisation parent ref
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const onRowActivate = (patientId: string) => {
    router.push(`/${locale}/crm/patients/${patientId}`);
  };

  // Empty state
  const isTrulyEmpty = !isLoading && rows.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      {/* Header row (table) — sortable columns */}
      <div
        role="table"
        aria-label={t("title")}
        aria-rowcount={total ?? rows.length}
        className="flex flex-col min-h-0 flex-1"
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid grid-cols-[minmax(240px,2fr)_140px_140px_160px_minmax(160px,1.2fr)] gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground"
        >
          <SortHeader
            id="fullName"
            label={t("columns.name")}
            active={sort}
            dir={dir}
            onClick={handleSortChange}
          />
          <div role="columnheader">{t("columns.segment")}</div>
          <SortHeader
            id="ltv"
            label={t("columns.ltv")}
            active={sort}
            dir={dir}
            onClick={handleSortChange}
          />
          <SortHeader
            id="lastVisitAt"
            label={t("columns.lastVisit")}
            active={sort}
            dir={dir}
            onClick={handleSortChange}
          />
          <div role="columnheader">{t("columns.tags")}</div>
        </div>

        {/* Virtualized body */}
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          style={{ contain: "strict" }}
        >
          {isLoading ? (
            <div className="p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonRow key={i} cols={5} />
              ))}
            </div>
          ) : isTrulyEmpty ? (
            <div className="p-4">
              <EmptyState
                icon={<UsersIcon />}
                title={
                  hasFilters ? t("empty.filteredTitle") : t("empty.title")
                }
                description={
                  hasFilters
                    ? t("empty.filteredDescription")
                    : t("empty.description")
                }
                action={
                  !hasFilters ? (
                    <Button onClick={onCreate}>{t("empty.action")}</Button>
                  ) : null
                }
              />
            </div>
          ) : (
            <div
              style={{
                height: `${totalSize}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualRows.map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index];
                if (!row) return null;
                const p = row.original;
                return (
                  <div
                    key={p.id}
                    role="row"
                    tabIndex={0}
                    onClick={() => onRowActivate(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowActivate(p.id);
                      }
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={cn(
                      "grid grid-cols-[minmax(240px,2fr)_140px_140px_160px_minmax(160px,1.2fr)] gap-4 border-b border-border px-4 py-3 text-sm transition-colors",
                      "cursor-pointer hover:bg-muted/40 focus:bg-muted/60 focus:outline-none",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        role="cell"
                        className="flex min-w-0 items-center"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasNextPage && !isLoading ? (
          <div className="flex items-center justify-center border-t border-border px-4 py-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? t("loading") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortHeader({
  id,
  label,
  active,
  dir,
  onClick,
}: {
  id: Exclude<PatientsListFilters["sort"], undefined>;
  label: string;
  active: PatientsListFilters["sort"];
  dir: PatientsListFilters["dir"];
  onClick: (id: Exclude<PatientsListFilters["sort"], undefined>) => void;
}) {
  const isActive = active === id;
  return (
    <button
      role="columnheader"
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "inline-flex items-center gap-1 text-left uppercase tracking-wide hover:text-foreground",
        isActive && "text-foreground",
      )}
      aria-sort={
        !isActive ? "none" : dir === "asc" ? "ascending" : "descending"
      }
    >
      {label}
      {isActive ? (
        dir === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )
      ) : null}
    </button>
  );
}
