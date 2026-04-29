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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BuildingIcon,
  CameraIcon,
  ClockIcon,
  FlameIcon,
  GlobeIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SendIcon,
  Share2Icon,
  SignalIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, formatName, type Locale } from "@/lib/format";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type {
  PatientRow,
  PatientsListFilters,
} from "../_hooks/use-patients-list";
import type { OptionalColumnId } from "./patients-kpi-tabs";

const SEGMENT_STYLE: Record<
  PatientRow["segment"],
  { tKey: string; className: string }
> = {
  NEW: {
    tKey: "segment.new",
    className: "bg-primary/10 text-primary",
  },
  ACTIVE: {
    tKey: "segment.active",
    className:
      "bg-success/15 text-success-foreground",
  },
  VIP: {
    tKey: "segment.vip",
    className: "bg-info/15 text-info",
  },
  DORMANT: {
    tKey: "segment.dormant",
    className:
      "bg-warning/15 text-warning-foreground",
  },
  CHURN: {
    tKey: "segment.churn",
    className: "bg-destructive/10 text-destructive",
  },
};

const SOURCE_ICON: Record<NonNullable<PatientRow["source"]>, LucideIcon> = {
  WEBSITE: GlobeIcon,
  TELEGRAM: SendIcon,
  INSTAGRAM: CameraIcon,
  CALL: PhoneIcon,
  WALKIN: BuildingIcon,
  REFERRAL: Share2Icon,
  ADS: MegaphoneIcon,
  OTHER: SignalIcon,
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

function priorityFor(p: PatientRow): "high" | "medium" | "low" | "none" {
  if (p.ltv >= 1_000_000) return "high";
  if (p.ltv >= 300_000) return "medium";
  if (p.ltv > 0) return "low";
  return "none";
}

const PRIORITY_CFG: Record<
  "high" | "medium" | "low" | "none",
  { tKey: string | null; icon: LucideIcon | null; className: string }
> = {
  high: {
    tKey: "priority.high",
    icon: FlameIcon,
    className: "bg-destructive/10 text-destructive",
  },
  medium: {
    tKey: "priority.medium",
    icon: ClockIcon,
    className:
      "bg-warning/15 text-warning-foreground",
  },
  low: {
    tKey: "priority.low",
    icon: SignalIcon,
    className:
      "bg-success/15 text-success-foreground",
  },
  none: {
    tKey: null,
    icon: null,
    className: "bg-muted text-muted-foreground",
  },
};

type ColMeta = {
  id: string;
  labelKey: string;
  gridSpan: string;
  sortable?: PatientsListFilters["sort"];
  alwaysVisible?: boolean;
  align?: "right";
};

const COL_META: ColMeta[] = [
  {
    id: "fullName",
    labelKey: "columns.name",
    gridSpan: "minmax(220px,1.6fr)",
    sortable: "fullName",
    alwaysVisible: true,
  },
  {
    id: "phone",
    labelKey: "columns.phone",
    gridSpan: "minmax(150px,1.1fr)",
    alwaysVisible: true,
  },
  {
    id: "lastVisitAt",
    labelKey: "columns.lastVisit",
    gridSpan: "minmax(160px,1.1fr)",
    sortable: "lastVisitAt",
  },
  {
    id: "nextVisitAt",
    labelKey: "columns.nextVisit",
    gridSpan: "minmax(160px,1.2fr)",
  },
  {
    id: "ltv",
    labelKey: "columns.ltv",
    gridSpan: "minmax(140px,1fr)",
    sortable: "ltv",
  },
  {
    id: "segment",
    labelKey: "columns.status",
    gridSpan: "140px",
    alwaysVisible: true,
  },
  { id: "priority", labelKey: "columns.priority", gridSpan: "150px" },
  { id: "source", labelKey: "columns.source", gridSpan: "72px" },
  {
    id: "actions",
    labelKey: "columns.actions",
    gridSpan: "90px",
    alwaysVisible: true,
    align: "right",
  },
];

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
  visibleColumns?: Record<OptionalColumnId, boolean>;
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
  visibleColumns,
}: PatientsTableProps) {
  const t = useTranslations("patients");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const visibleColMeta = React.useMemo(
    () =>
      COL_META.filter(
        (c) =>
          c.alwaysVisible ||
          visibleColumns?.[c.id as OptionalColumnId] !== false,
      ),
    [visibleColumns],
  );
  const visibleIds = React.useMemo(
    () => new Set(visibleColMeta.map((c) => c.id)),
    [visibleColMeta],
  );
  const colsTemplate = React.useMemo(
    () => visibleColMeta.map((c) => c.gridSpan).join(" "),
    [visibleColMeta],
  );

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
          const display =
            formatName(first, last, patronymic, "full") || p.fullName;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <AvatarWithStatus
                src={p.photoUrl ?? undefined}
                name={p.fullName}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {display}
                  </span>
                  {p.segment === "VIP" ? (
                    <span className="inline-flex h-4 items-center rounded bg-info/15 px-1 text-[9px] font-bold uppercase text-info">
                      VIP
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {age !== null ? (
                    <>
                      {t("ageYears", { age })}
                      {p.birthDate ? (
                        <> · {formatDate(p.birthDate, locale, "short")}</>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "phone",
        header: () => t("columns.phone"),
        cell: ({ row }) => {
          const p = row.original;
          const Icon = p.source ? SOURCE_ICON[p.source] : PhoneIcon;
          return (
            <div className="flex items-center gap-1.5 text-[13px] tabular-nums text-foreground">
              <span className="truncate">{p.phone}</span>
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            </div>
          );
        },
      },
      {
        id: "lastVisitAt",
        header: () => t("columns.lastVisit"),
        cell: ({ row }) => {
          const v = row.original.lastVisitAt;
          if (!v)
            return <span className="text-[12px] text-muted-foreground">—</span>;
          return (
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] tabular-nums text-foreground">
                {formatDate(v, locale, "short")}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {formatDate(v, locale, "relative")}
              </span>
            </div>
          );
        },
      },
      {
        id: "nextVisitAt",
        header: () => t("columns.nextVisit"),
        cell: ({ row }) => {
          const v = row.original.nextVisitAt;
          if (!v) {
            return (
              <div className="flex flex-col">
                <span className="text-[12px] text-muted-foreground">—</span>
                <span className="text-[11px] text-muted-foreground">
                  {t("table.noAppointment")}
                </span>
              </div>
            );
          }
          const d = new Date(v);
          const hh = String(d.getHours()).padStart(2, "0");
          const mm = String(d.getMinutes()).padStart(2, "0");
          return (
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] tabular-nums text-foreground">
                {formatDate(v, locale, "short")}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {hh}:{mm}
              </span>
            </div>
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
            className="text-[13px] font-semibold"
          />
        ),
      },
      {
        id: "segment",
        header: () => t("columns.status"),
        cell: ({ row }) => {
          const cfg = SEGMENT_STYLE[row.original.segment];
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
                cfg.className,
              )}
            >
              {t(cfg.tKey as never)}
            </span>
          );
        },
      },
      {
        id: "priority",
        header: () => t("columns.priority"),
        cell: ({ row }) => {
          const key = priorityFor(row.original);
          const cfg = PRIORITY_CFG[key];
          const Icon = cfg.icon;
          if (key === "none" || !cfg.tKey)
            return (
              <span className="text-[12px] text-muted-foreground">—</span>
            );
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                cfg.className,
              )}
            >
              {Icon ? <Icon className="size-3" aria-hidden /> : null}
              {t(cfg.tKey as never)}
            </span>
          );
        },
      },
      {
        id: "source",
        header: () => t("columns.source"),
        cell: ({ row }) => {
          const src = row.original.source;
          if (!src)
            return <span className="text-[12px] text-muted-foreground">—</span>;
          const Icon = SOURCE_ICON[src];
          const label = t(`source.${src.toLowerCase()}` as never);
          return (
            <span
              className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
              title={label}
              aria-label={label}
            >
              <Icon className="size-3.5" />
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => (
          <span className="sr-only">{t("columns.actions")}</span>
        ),
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div
              className="flex items-center justify-end gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <IconAction
                icon={PhoneIcon}
                label={t("rowActions.call")}
                onClick={() => {
                  if (typeof window !== "undefined")
                    window.location.href = `tel:${p.phoneNormalized || p.phone}`;
                }}
              />
              {p.telegramUsername ? (
                <IconAction
                  icon={MessageCircleIcon}
                  label="Telegram"
                  onClick={() => {
                    if (typeof window !== "undefined")
                      window.open(
                        `https://t.me/${p.telegramUsername}`,
                        "_blank",
                      );
                  }}
                />
              ) : null}
              <IconAction
                icon={MoreHorizontalIcon}
                label={t("rowActions.more")}
                onClick={() => {}}
              />
            </div>
          );
        },
      },
    ],
    [t, locale],
  );

  const filteredColumns = React.useMemo(
    () => columns.filter((c) => visibleIds.has(c.id ?? "")),
    [columns, visibleIds],
  );

  const table = useReactTable({
    data: rows,
    columns: filteredColumns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const [animInitial, setAnimInitial] = React.useState(true);
  React.useEffect(() => {
    const id = window.setTimeout(() => setAnimInitial(false), 800);
    return () => window.clearTimeout(id);
  }, []);

  const onRowActivate = (patientId: string) => {
    router.push(`/${locale}/crm/patients/${patientId}`);
  };

  const isTrulyEmpty = !isLoading && rows.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card">
      <div
        role="table"
        aria-label={t("title")}
        aria-rowcount={total ?? rows.length}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: colsTemplate }}
        >
          {visibleColMeta.map((c) => {
            if (c.sortable) {
              return (
                <SortHeader
                  key={c.id}
                  id={c.sortable}
                  label={t(c.labelKey as never)}
                  active={sort}
                  dir={dir}
                  onClick={handleSortChange}
                />
              );
            }
            const isActions = c.id === "actions";
            return (
              <div
                key={c.id}
                role="columnheader"
                className={cn(c.align === "right" && "text-right")}
              >
                {isActions ? (
                  <span className="sr-only">{t(c.labelKey as never)}</span>
                ) : (
                  t(c.labelKey as never)
                )}
              </div>
            );
          })}
        </div>

        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          style={{ contain: "strict" }}
        >
          {isLoading ? (
            <div className="p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonRow key={i} cols={9} />
              ))}
            </div>
          ) : isTrulyEmpty ? (
            <div className="p-4">
              <EmptyState
                icon={<UsersIcon />}
                title={hasFilters ? t("empty.filteredTitle") : t("empty.title")}
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
                const animate = animInitial && virtualRow.index < 12;
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
                      gridTemplateColumns: colsTemplate,
                      animationDelay: animate
                        ? `${virtualRow.index * 35}ms`
                        : undefined,
                    }}
                    className={cn(
                      "grid items-center gap-3 border-b border-border px-4 py-3 text-sm transition-colors",
                      "cursor-pointer hover:bg-muted/30 focus:bg-muted/60 focus:outline-none",
                      animate && "table-row-fade-stagger",
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

function IconAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
}
