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
  CalendarIcon,
  GlobeIcon,
  HomeIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SendIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { PhoneText } from "@/components/atoms/phone-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import {
  paymentStatusFor,
  type AppointmentRow,
  type AppointmentsListFilters,
} from "../_hooks/use-appointments-list";

const STATUS_VARIANT: Record<
  AppointmentRow["status"],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  BOOKED: "info",
  WAITING: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  SKIPPED: "muted",
  CANCELLED: "destructive",
  NO_SHOW: "muted",
};

const CHANNEL_ICON: Record<AppointmentRow["channel"], React.ElementType> = {
  WALKIN: HomeIcon,
  PHONE: PhoneIcon,
  TELEGRAM: SendIcon,
  WEBSITE: GlobeIcon,
  KIOSK: UserIcon,
};

export interface AppointmentsTableProps {
  rows: AppointmentRow[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  hasFilters: boolean;
  onCreate: () => void;
  onRowSelect: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, on: boolean) => void;
  onToggleSelectAll: (on: boolean) => void;
  sort: AppointmentsListFilters["sort"];
  dir: AppointmentsListFilters["dir"];
  onSortChange: (
    sort: AppointmentsListFilters["sort"],
    dir: AppointmentsListFilters["dir"],
  ) => void;
  total: number | null;
}

const COLS_TEMPLATE =
  "40px minmax(220px,1.6fr) minmax(180px,1.3fr) minmax(180px,1.4fr) 150px minmax(160px,1.2fr) 110px 120px 120px";

/**
 * Compute the "row tone" — danger when overdue, warning when soon, none
 * otherwise. Used to tint the row background.
 */
function rowTone(
  row: AppointmentRow,
  now: number,
): "danger" | "warning" | null {
  const startMs = new Date(row.date).getTime();
  const fiveMin = 5 * 60 * 1000;
  const fifteenMin = 15 * 60 * 1000;
  const isLate =
    (row.status === "BOOKED" || row.status === "WAITING") &&
    now - startMs > fiveMin;
  if (isLate) return "danger";
  if (
    row.status === "BOOKED" &&
    startMs - now >= 0 &&
    startMs - now <= fifteenMin
  ) {
    return "warning";
  }
  return null;
}

function formatTimeRange(row: AppointmentRow): string {
  const start = new Date(row.date);
  const end = new Date(row.endDate);
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function lateMinutes(row: AppointmentRow, now: number): number {
  const startMs = new Date(row.date).getTime();
  return Math.max(0, Math.round((now - startMs) / 60000));
}

function riskScore(row: AppointmentRow, now: number): "high" | "medium" | "low" {
  if (row.status === "NO_SHOW") return "high";
  const startMs = new Date(row.date).getTime();
  const diffMin = (now - startMs) / 60000;
  if ((row.status === "BOOKED" || row.status === "WAITING") && diffMin > 15) {
    return "high";
  }
  if (row.channel === "PHONE" || row.channel === "WEBSITE") return "medium";
  return "low";
}

export function AppointmentsTable({
  rows,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  hasFilters,
  onCreate,
  onRowSelect,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  sort,
  dir,
  onSortChange,
  total,
}: AppointmentsTableProps) {
  const t = useTranslations("appointments");
  const locale = useLocale() as Locale;
  const router = useRouter();

  // Single timestamp for the whole render so all row tone / delay calcs agree.
  // Refreshes whenever the rows list changes (i.e. new server data arrived).
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    setNow(Date.now());
  }, [rows]);

  const sorting: SortingState = React.useMemo(
    () => (sort ? [{ id: sort, desc: dir !== "asc" }] : []),
    [sort, dir],
  );

  const handleSortChange = React.useCallback(
    (columnId: NonNullable<AppointmentsListFilters["sort"]>) => {
      let nextDir: AppointmentsListFilters["dir"] = "asc";
      if (sort === columnId) nextDir = dir === "asc" ? "desc" : "asc";
      onSortChange(columnId, nextDir);
    },
    [sort, dir, onSortChange],
  );

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected =
    !allSelected && rows.some((r) => selectedIds.has(r.id));

  const columns = React.useMemo<ColumnDef<AppointmentRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => onToggleSelectAll(v === true)}
            aria-label={t("columns.select")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={(v) =>
              onToggleSelect(row.original.id, v === true)
            }
            onClick={(e) => e.stopPropagation()}
            aria-label={t("columns.select")}
          />
        ),
      },
      {
        id: "patient",
        header: () => t("columns.patient"),
        cell: ({ row }) => {
          const p = row.original.patient;
          const isVip = /VIP/i.test(p.fullName);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <AvatarWithStatus
                src={p.photoUrl ?? undefined}
                name={p.fullName}
                size="sm"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {p.fullName}
                  </span>
                  {isVip ? (
                    <span className="inline-flex items-center rounded-md bg-warning/15 px-1 py-px text-[9px] font-bold uppercase text-[color:var(--warning)]">
                      VIP
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground tabular-nums">
                  <PhoneText phone={p.phone} asText />
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "service",
        header: () => t("columns.services"),
        cell: ({ row }) => {
          const primary = row.original.primaryService;
          const lines = row.original.services;
          const name =
            primary
              ? locale === "uz"
                ? primary.nameUz
                : primary.nameRu
              : lines[0]
                ? locale === "uz"
                  ? lines[0].service.nameUz
                  : lines[0].service.nameRu
                : "—";
          const extra = Math.max(0, lines.length - 1);
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {row.original.status === "BOOKED"
                  ? t("cell.firstVisit")
                  : extra > 0
                    ? t("cell.extraServices", { count: extra })
                    : row.original.comments
                      ? row.original.comments
                      : t("cell.appointment")}
              </span>
            </div>
          );
        },
      },
      {
        id: "doctor",
        header: () => `${t("columns.doctor")} / ${t("columns.cabinet")}`,
        cell: ({ row }) => {
          const d = row.original.doctor;
          const c = row.original.cabinet;
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {locale === "uz" ? d.nameUz : d.nameRu}
              </span>
              <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                {c ? t("cell.cabinetN", { number: c.number }) : t("cell.noCabinet")}
              </span>
            </div>
          );
        },
      },
      {
        id: "date",
        header: () => t("columns.time"),
        cell: ({ row }) => {
          const r = row.original;
          const tone = rowTone(r, now);
          const late = tone === "danger" ? lateMinutes(r, now) : 0;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {formatTimeRange(r)}
              </span>
              {late > 0 ? (
                <span className="mt-0.5 inline-flex w-fit items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-bold text-destructive">
                  {t("cell.lateMin", { min: late })}
                </span>
              ) : tone === "warning" ? (
                <span className="mt-0.5 inline-flex w-fit items-center rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--warning)]">
                  {t("cell.inMin", {
                    min: Math.max(
                      0,
                      Math.round(
                        (new Date(r.date).getTime() - now) / 60000,
                      ),
                    ),
                  })}
                </span>
              ) : (
                <span className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(r.date, locale, "short")}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "status",
        header: () => `${t("columns.status")} / ${t("columns.source")}`,
        cell: ({ row }) => {
          const r = row.original;
          const Icon = CHANNEL_ICON[r.channel];
          return (
            <div className="flex flex-col gap-1">
              <Badge variant={STATUS_VARIANT[r.status]} className="w-fit">
                {t(`status.${r.status.toLowerCase()}` as never)}
              </Badge>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Icon className="size-3" />
                {t(`channel.${r.channel.toLowerCase()}` as never)}
              </span>
            </div>
          );
        },
      },
      {
        id: "risk",
        header: () => t("columns.riskNoShow"),
        cell: ({ row }) => {
          const r = riskScore(row.original, now);
          const label = t(`risk.${r}` as never);
          const cls =
            r === "high"
              ? "bg-destructive/10 text-destructive"
              : r === "medium"
                ? "bg-warning/15 text-[color:var(--warning)]"
                : "bg-success/15 text-[color:var(--success)]";
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
                cls,
              )}
            >
              {label}
            </span>
          );
        },
      },
      {
        id: "payment",
        header: () => t("columns.amount"),
        cell: ({ row }) => {
          const r = row.original;
          const ps = paymentStatusFor(r);
          return (
            <div className="flex flex-col items-start">
              {r.priceFinal !== null ? (
                <MoneyText
                  amount={r.priceFinal}
                  currency="UZS"
                  className="text-sm font-semibold text-foreground tabular-nums"
                />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  ps === "PAID"
                    ? "text-[color:var(--success)]"
                    : ps === "PARTIAL"
                      ? "text-[color:var(--warning)]"
                      : "text-muted-foreground",
                )}
              >
                {t(`payment.${ps.toLowerCase()}` as never)}
              </span>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const r = row.original;
          const tel = r.patient.phone.replace(/\s/g, "");
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                aria-label={t("cell.callAria")}
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = `tel:${tel}`;
                }}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <PhoneIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("cell.telegramAria")}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <SendIcon className="size-3.5" />
              </button>
              <RowMenu
                onOpen={() => onRowSelect(r.id)}
                onOpenPatient={() =>
                  router.push(`/${locale}/crm/patients/${r.patient.id}`)
                }
                onCall={() => {
                  window.location.href = `tel:${tel}`;
                }}
              />
            </div>
          );
        },
      },
    ],
    [
      t,
      locale,
      router,
      allSelected,
      someSelected,
      onToggleSelectAll,
      onToggleSelect,
      selectedIds,
      onRowSelect,
      now,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableRowSelection: true,
  });

  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

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
          className="sticky top-0 z-10 grid items-center gap-2 border-b border-border bg-card px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: COLS_TEMPLATE }}
        >
          <div role="columnheader" className="flex items-center">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={(v) => onToggleSelectAll(v === true)}
              aria-label={t("columns.select")}
            />
          </div>
          <div role="columnheader">{t("columns.patient")}</div>
          <div role="columnheader">{t("columns.services")}</div>
          <div role="columnheader">
            {t("columns.doctor")} / {t("columns.cabinet")}
          </div>
          <SortHeader
            id="date"
            label={t("columns.time")}
            active={sort}
            dir={dir}
            onClick={handleSortChange}
          />
          <div role="columnheader">{t("columns.status")} / {t("columns.source")}</div>
          <div role="columnheader">{t("columns.riskNoShow")}</div>
          <div role="columnheader">{t("columns.amount")}</div>
          <div role="columnheader" className="text-right">
            <span className="sr-only">{t("columns.actions")}</span>
          </div>
        </div>

        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          style={{ contain: "strict" }}
        >
          {isLoading ? (
            <div className="p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonRow key={i} cols={8} />
              ))}
            </div>
          ) : isTrulyEmpty ? (
            <div className="p-4">
              <EmptyState
                icon={<CalendarIcon />}
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
                const a = row.original;
                const checked = selectedIds.has(a.id);
                const tone = rowTone(a, now);
                return (
                  <div
                    key={a.id}
                    role="row"
                    tabIndex={0}
                    onClick={() => onRowSelect(a.id)}
                    onDoubleClick={() =>
                      router.push(`/${locale}/crm/appointments?ap=${a.id}`)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowSelect(a.id);
                      }
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: COLS_TEMPLATE,
                    }}
                    className={cn(
                      "grid items-center gap-2 border-b border-border px-3 py-2.5 text-sm transition-colors",
                      "cursor-pointer focus:outline-none",
                      tone === "danger" && "bg-destructive/[0.04] hover:bg-destructive/[0.07]",
                      tone === "warning" && "bg-warning/[0.06] hover:bg-warning/[0.1]",
                      tone === null && "hover:bg-muted/40",
                      checked && "ring-1 ring-inset ring-primary/40",
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
  id: NonNullable<AppointmentsListFilters["sort"]>;
  label: string;
  active: AppointmentsListFilters["sort"];
  dir: AppointmentsListFilters["dir"];
  onClick: (id: NonNullable<AppointmentsListFilters["sort"]>) => void;
}) {
  const isActive = active === id;
  return (
    <button
      role="columnheader"
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "inline-flex items-center gap-1 text-left hover:text-foreground",
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

function RowMenu({
  onOpen,
  onOpenPatient,
  onCall,
}: {
  onOpen: () => void;
  onOpenPatient: () => void;
  onCall: () => void;
}) {
  const t = useTranslations("appointments.rowActions");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("more")}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onClick={onOpen}>{t("open")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenPatient}>
          {t("openPatient")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCall}>{t("call")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
