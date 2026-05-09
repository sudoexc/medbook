"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarIcon, ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { PatientsFilterState } from "../_hooks/use-patients-filters";
import type { OptionalColumnId } from "./patients-kpi-tabs";

export interface PatientsFiltersProps {
  state: PatientsFilterState;
  onChange: <K extends keyof PatientsFilterState>(
    key: K,
    value: PatientsFilterState[K] | undefined,
  ) => void;
  onClear: () => void;
  visibleColumns?: Record<OptionalColumnId, boolean>;
  onToggleColumn?: (id: OptionalColumnId, next: boolean) => void;
  className?: string;
}

const SEGMENTS = ["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"] as const;
const SOURCES = [
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
] as const;

const COLUMN_LABEL_KEY: Record<OptionalColumnId, string> = {
  lastVisitAt: "columns.lastVisit",
  nextVisitAt: "columns.nextVisit",
  ltv: "columns.ltv",
  priority: "columns.priority",
  source: "columns.source",
};

const TOTAL_OPTIONAL_COLUMNS = 5;

export function PatientsFilters({
  state,
  onChange,
  onClear,
  visibleColumns,
  onToggleColumn,
  className,
}: PatientsFiltersProps) {
  const t = useTranslations("patients");
  const [searchLocal, setSearchLocal] = React.useState(state.q ?? "");

  React.useEffect(() => {
    setSearchLocal(state.q ?? "");
  }, [state.q]);

  React.useEffect(() => {
    const current = state.q ?? "";
    if (searchLocal === current) return;
    const id = window.setTimeout(() => {
      onChange("q", searchLocal || undefined);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchLocal, state.q, onChange]);

  const hasAnyFilter =
    Boolean(state.q) ||
    Boolean(state.segment) ||
    Boolean(state.gender) ||
    Boolean(state.source) ||
    Boolean(state.tag) ||
    Boolean(state.ageMin) ||
    Boolean(state.ageMax) ||
    Boolean(state.registeredFrom) ||
    Boolean(state.registeredTo) ||
    state.balance === "debt";

  const datesEmpty = !state.registeredFrom && !state.registeredTo;
  const shownColumns = visibleColumns
    ? Object.values(visibleColumns).filter(Boolean).length
    : TOTAL_OPTIONAL_COLUMNS;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-3",
        className,
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <FilterCell label={t("filters.labelSearch")}>
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchLocal}
              onChange={(e) => setSearchLocal(e.target.value)}
              placeholder={t("filters.search")}
              className="h-9 pl-8"
              aria-label={t("filters.search")}
            />
          </div>
        </FilterCell>

        <FilterCell label={t("filters.labelStatus")}>
          <FilterSelect
            value={state.segment}
            onValueChange={(v) => onChange("segment", v)}
            placeholder={t("filters.segmentAll")}
            items={SEGMENTS.map((s) => ({
              value: s,
              label: t(`segment.${s.toLowerCase()}` as never),
            }))}
          />
        </FilterCell>

        <FilterCell label={t("filters.labelSource")}>
          <FilterSelect
            value={state.source}
            onValueChange={(v) => onChange("source", v)}
            placeholder={t("filters.sourceAll")}
            items={SOURCES.map((s) => ({
              value: s,
              label: t(`source.${s.toLowerCase()}` as never),
            }))}
          />
        </FilterCell>

        <FilterCell label={t("filters.labelDate")}>
          <div
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm",
              datesEmpty && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            {datesEmpty ? (
              <>
                <span className="flex-1 truncate text-[12px]">
                  {t("filters.datePlaceholder")}
                </span>
                <Input
                  type="date"
                  className="h-8 w-0 border-0 p-0 opacity-0 shadow-none focus-visible:ring-0"
                  value=""
                  onChange={(e) =>
                    onChange("registeredFrom", e.target.value || undefined)
                  }
                  aria-label={t("filters.lastVisitFrom")}
                />
              </>
            ) : (
              <>
                <Input
                  type="date"
                  className="h-8 w-full min-w-0 flex-1 border-0 p-0 text-[12px] shadow-none focus-visible:ring-0"
                  value={state.registeredFrom ?? ""}
                  onChange={(e) =>
                    onChange("registeredFrom", e.target.value || undefined)
                  }
                  aria-label={t("filters.lastVisitFrom")}
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  type="date"
                  className="h-8 w-full min-w-0 flex-1 border-0 p-0 text-[12px] shadow-none focus-visible:ring-0"
                  value={state.registeredTo ?? ""}
                  onChange={(e) =>
                    onChange("registeredTo", e.target.value || undefined)
                  }
                  aria-label={t("filters.lastVisitTo")}
                />
              </>
            )}
          </div>
        </FilterCell>

        <FilterCell label={t("filters.labelSegments")}>
          <FilterSelect
            value={state.segment}
            onValueChange={(v) => onChange("segment", v)}
            placeholder={t("rail.viewAllSegments")}
            items={SEGMENTS.map((s) => ({
              value: s,
              label: t(`segment.${s.toLowerCase()}` as never),
            }))}
          />
        </FilterCell>

        <FilterCell label={t("filters.labelTableSettings")}>
          <TableConfigMenu
            shown={shownColumns}
            total={TOTAL_OPTIONAL_COLUMNS}
            visibleColumns={visibleColumns}
            onToggleColumn={onToggleColumn}
          />
        </FilterCell>
      </div>

      {hasAnyFilter ? (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            <XIcon className="size-4" />
            {t("filters.clear")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  items,
}: {
  value: string | undefined;
  onValueChange: (next: string | undefined) => void;
  placeholder: string;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <Select
      value={value ?? "__all"}
      onValueChange={(v) => onValueChange(v === "__all" ? undefined : v)}
    >
      <SelectTrigger className="h-9 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{placeholder}</SelectItem>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value}>
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableConfigMenu({
  shown,
  total,
  visibleColumns,
  onToggleColumn,
}: {
  shown: number;
  total: number;
  visibleColumns?: Record<OptionalColumnId, boolean>;
  onToggleColumn?: (id: OptionalColumnId, next: boolean) => void;
}) {
  const t = useTranslations("patients");
  const disabled = !visibleColumns || !onToggleColumn;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-[13px] text-foreground hover:bg-muted/40"
        >
          <span className="truncate">
            {t("filters.tableColumnCount", { shown, total })}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("filters.labelTableSettings")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(COLUMN_LABEL_KEY) as OptionalColumnId[]).map((id) => {
          const isOn = visibleColumns?.[id] ?? true;
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={isOn}
              disabled={disabled}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(next) => onToggleColumn?.(id, Boolean(next))}
              className="text-[13px]"
            >
              {t(COLUMN_LABEL_KEY[id] as never)}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
