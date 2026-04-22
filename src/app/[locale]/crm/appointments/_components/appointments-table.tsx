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

const PAYMENT_VARIANT: Record<
  "PAID" | "PARTIAL" | "UNPAID",
  React.ComponentProps<typeof Badge>["variant"]
> = {
  PAID: "success",
  PARTIAL: "warning",
  UNPAID: "muted",
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
  "40px 120px minmax(220px,2fr) minmax(180px,1.5fr) minmax(160px,1.5fr) 120px 140px 130px 80px 60px";

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
        id: "date",
        header: () => t("columns.time"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex min-w-0 flex-col">
              <span className="font-medium tabular-nums">
                {r.time ?? formatDate(r.date, locale, "time")}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(r.date, locale, "short")}
              </span>
            </div>
          );
        },
      },
      {
        id: "patient",
        header: () => t("columns.patient"),
        cell: ({ row }) => {
          const p = row.original.patient;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <AvatarWithStatus
                src={p.photoUrl ?? undefined}
                name={p.fullName}
                size="sm"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {p.fullName}
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
        id: "doctor",
        header: () => t("columns.doctor"),
        cell: ({ row }) => {
          const d = row.original.doctor;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <AvatarWithStatus
                src={d.photoUrl ?? undefined}
                name={d.nameRu}
                size="sm"
              />
              <div className="min-w-0 truncate text-sm text-foreground">
                {locale === "uz" ? d.nameUz : d.nameRu}
              </div>
            </div>
          );
        },
      },
      {
        id: "services",
        header: () => t("columns.services"),
        cell: ({ row }) => {
          const lines = row.original.services;
          const primary = row.original.primaryService;
          if (lines.length === 0 && !primary) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          if (lines.length === 0 && primary) {
            return (
              <span className="truncate text-sm">
                {locale === "uz" ? primary.nameUz : primary.nameRu}
              </span>
            );
          }
          const head = lines[0]!.service;
          const rest = lines.length - 1;
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">
                {locale === "uz" ? head.nameUz : head.nameRu}
              </span>
              {rest > 0 ? (
                <span className="text-xs text-muted-foreground">
                  +{rest} {t("columns.moreServices")}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "status",
        header: () => t("columns.status"),
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <Badge variant={STATUS_VARIANT[s]}>
              {t(`status.${s.toLowerCase()}` as never)}
            </Badge>
          );
        },
      },
      {
        id: "payment",
        header: () => t("columns.payment"),
        cell: ({ row }) => {
          const r = row.original;
          const ps = paymentStatusFor(r);
          return (
            <div className="flex flex-col items-start gap-0.5">
              <Badge variant={PAYMENT_VARIANT[ps]}>
                {t(`payment.${ps.toLowerCase()}` as never)}
              </Badge>
              {r.priceFinal !== null ? (
                <MoneyText
                  amount={r.priceFinal}
                  currency="UZS"
                  className="text-xs text-muted-foreground"
                />
              ) : null}
            </div>
          );
        },
      },
      {
        id: "cabinet",
        header: () => t("columns.cabinet"),
        cell: ({ row }) => {
          const c = row.original.cabinet;
          return c ? (
            <span className="text-sm tabular-nums">№{c.number}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "channel",
        header: () => t("columns.channel"),
        cell: ({ row }) => {
          const ch = row.original.channel;
          const Icon = CHANNEL_ICON[ch];
          return (
            <div
              className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
              title={t(`channel.${ch.toLowerCase()}` as never)}
              aria-label={t(`channel.${ch.toLowerCase()}` as never)}
            >
              <Icon className="size-3.5" />
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <RowMenu
            onOpen={() => onRowSelect(row.original.id)}
            onOpenPatient={() =>
              router.push(
                `/${locale}/crm/patients/${row.original.patient.id}`,
              )
            }
            onCall={() => {
              const tel = row.original.patient.phone.replace(/\s/g, "");
              window.location.href = `tel:${tel}`;
            }}
          />
        ),
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
    estimateSize: () => 60,
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const isTrulyEmpty = !isLoading && rows.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
      <div
        role="table"
        aria-label={t("title")}
        aria-rowcount={total ?? rows.length}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground"
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
          <SortHeader
            id="date"
            label={t("columns.time")}
            active={sort}
            dir={dir}
            onClick={handleSortChange}
          />
          <div role="columnheader">{t("columns.patient")}</div>
          <div role="columnheader">{t("columns.doctor")}</div>
          <div role="columnheader">{t("columns.services")}</div>
          <div role="columnheader">{t("columns.status")}</div>
          <div role="columnheader">{t("columns.payment")}</div>
          <div role="columnheader">{t("columns.cabinet")}</div>
          <div role="columnheader">{t("columns.channel")}</div>
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
                <SkeletonRow key={i} cols={9} />
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
                      "cursor-pointer hover:bg-muted/40 focus:bg-muted/60 focus:outline-none",
                      checked && "bg-primary/5",
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
