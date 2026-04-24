"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarIcon, SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { PatientsFilterState } from "../_hooks/use-patients-filters";

export interface PatientsFiltersProps {
  state: PatientsFilterState;
  onChange: <K extends keyof PatientsFilterState>(
    key: K,
    value: PatientsFilterState[K] | undefined,
  ) => void;
  onClear: () => void;
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

/**
 * Compact filter row under the KPI tabs — docs/5 - Пациенты (2).png.
 *
 * Drops the age range + debt checkbox inline chips — those now live behind the
 * "Фильтры" popover from the tab toolbar (future). Visible here: search,
 * segment, source, last-visit range, clear.
 */
export function PatientsFilters({
  state,
  onChange,
  onClear,
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

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2",
        className,
      )}
    >
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchLocal}
          onChange={(e) => setSearchLocal(e.target.value)}
          placeholder={t("filters.search")}
          className="pl-8"
          aria-label={t("filters.search")}
        />
      </div>

      <FilterSelect
        value={state.segment}
        onValueChange={(v) => onChange("segment", v)}
        placeholder={t("filters.segmentAll")}
        items={SEGMENTS.map((s) => ({
          value: s,
          label: t(`segment.${s.toLowerCase()}` as never),
        }))}
      />

      <FilterSelect
        value={state.source}
        onValueChange={(v) => onChange("source", v)}
        placeholder={t("filters.sourceAll")}
        items={SOURCES.map((s) => ({
          value: s,
          label: t(`source.${s.toLowerCase()}` as never),
        }))}
      />

      <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm">
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        <Input
          type="date"
          className="h-8 w-[140px] border-0 p-0 text-[12px] shadow-none focus-visible:ring-0"
          value={state.registeredFrom ?? ""}
          onChange={(e) =>
            onChange("registeredFrom", e.target.value || undefined)
          }
          aria-label={t("filters.lastVisitFrom")}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          className="h-8 w-[140px] border-0 p-0 text-[12px] shadow-none focus-visible:ring-0"
          value={state.registeredTo ?? ""}
          onChange={(e) =>
            onChange("registeredTo", e.target.value || undefined)
          }
          aria-label={t("filters.lastVisitTo")}
        />
      </div>

      {hasAnyFilter ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <XIcon className="size-4" />
          {t("filters.clear")}
        </Button>
      ) : null}
    </div>
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
      <SelectTrigger className="w-[160px]">
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
