"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

import type {
  CabinetRef,
  DoctorResource,
  ServiceRef,
} from "../_hooks/use-calendar-data";
import type {
  CalendarFilters,
  CalendarView,
} from "../_hooks/use-calendar-filters";

const VIEWS: { key: CalendarView }[] = [
  { key: "day" },
  { key: "workWeek" },
  { key: "week" },
];

export interface CalendarToolbarProps {
  filters: CalendarFilters;
  onChange: (next: Partial<CalendarFilters>) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreateClick: () => void;
  doctors: DoctorResource[];
  cabinets: CabinetRef[];
  services: ServiceRef[];
  rangeLabel: string;
}

export function CalendarToolbar({
  filters,
  onChange,
  onPrev,
  onNext,
  onToday,
  onCreateClick,
  doctors,
  cabinets,
  services,
  rangeLabel,
}: CalendarToolbarProps) {
  const t = useTranslations("calendar");
  const locale = useLocale();

  const filterCount =
    filters.doctorIds.length +
    filters.cabinetIds.length +
    filters.serviceIds.length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2.5">
      {/* Date navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onPrev}
          aria-label={t("prev")}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          {t("today")}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onNext}
          aria-label={t("next")}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      <Popover>
        <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted">
          <CalendarIcon className="size-4 text-muted-foreground" />
          <span className="tabular-nums">{rangeLabel}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <Input
            type="date"
            value={filters.date}
            onChange={(e) => {
              if (e.target.value) onChange({ date: e.target.value });
            }}
            className="h-9"
            aria-label={t("today")}
          />
        </PopoverContent>
      </Popover>

      {/* View switcher */}
      <div
        className="flex items-center rounded-md bg-muted/60 p-0.5"
        role="tablist"
      >
        {VIEWS.map((v) => {
          const active = filters.view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ view: v.key })}
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`views.${v.key}` as const)}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* Consolidated filters */}
      <Popover>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm hover:bg-muted">
          <FilterIcon className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{t("filtersLabel")}</span>
          {filterCount > 0 ? (
            <Badge variant="muted" className="h-5 px-1.5 text-[10px]">
              {filterCount}
            </Badge>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <div className="flex flex-col gap-3">
            <FilterRow
              label={t("filters.doctors")}
              allLabel={t("filters.doctorsAll")}
              selectedLabel={(n) => t("filters.doctorsSelected", { count: n })}
              items={doctors.map((d) => ({
                id: d.id,
                label: locale === "uz" ? d.nameUz : d.nameRu,
                color: d.color ?? undefined,
              }))}
              value={filters.doctorIds}
              onChange={(ids) => onChange({ doctorIds: ids })}
            />
            <FilterRow
              label={t("filters.cabinets")}
              allLabel={t("filters.cabinetsAll")}
              selectedLabel={(n) => t("filters.cabinetsSelected", { count: n })}
              items={cabinets.map((c) => ({ id: c.id, label: `№${c.number}` }))}
              value={filters.cabinetIds}
              onChange={(ids) => onChange({ cabinetIds: ids })}
            />
            <FilterRow
              label={t("filters.services")}
              allLabel={t("filters.servicesAll")}
              selectedLabel={(n) => t("filters.servicesSelected", { count: n })}
              items={services.map((s) => ({
                id: s.id,
                label: locale === "uz" ? s.nameUz : s.nameRu,
              }))}
              value={filters.serviceIds}
              onChange={(ids) => onChange({ serviceIds: ids })}
            />
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <Switch
                id="overlay-toggle"
                checked={filters.cabinetOverlay}
                onCheckedChange={(on) => onChange({ cabinetOverlay: on })}
              />
              <Label htmlFor="overlay-toggle" className="cursor-pointer text-xs">
                {t("filters.cabinetOverlay")}
              </Label>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="outline" size="sm">
        <SettingsIcon className="size-3.5" />
        {t("configureView")}
      </Button>

      <Button size="sm" onClick={onCreateClick}>
        <PlusIcon className="size-4" />
        {t("newAppointment")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterRow — one row inside the consolidated filters popover.
// ---------------------------------------------------------------------------

type Item = { id: string; label: string; color?: string };

function FilterRow({
  label,
  allLabel,
  selectedLabel,
  items,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  selectedLabel: (n: number) => string;
  items: Item[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("calendar.filters");
  const [open, setOpen] = React.useState(false);
  const selectedCount = value.length;

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm hover:bg-muted">
          {selectedCount > 0 ? (
            <Badge variant="muted" className="h-5 px-1.5 text-[10px]">
              {selectedLabel(selectedCount)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{allLabel}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">▾</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty>{t("search")}</CommandEmpty>
              <CommandGroup>
                {items.map((it) => {
                  const active = value.includes(it.id);
                  return (
                    <CommandItem
                      key={it.id}
                      value={it.label}
                      onSelect={() => toggle(it.id)}
                      className="flex items-center gap-2"
                    >
                      <div
                        className={cn(
                          "flex size-4 items-center justify-center rounded border",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {active ? <span className="text-xs">✓</span> : null}
                      </div>
                      {it.color ? (
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: it.color }}
                        />
                      ) : null}
                      <span className="flex-1 truncate">{it.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            {selectedCount > 0 ? (
              <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {selectedLabel(selectedCount)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange([])}
                >
                  {t("clear")}
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function defaultRangeLabel(from: Date, to: Date, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "numeric",
    month: "short",
  });
  const yf = from.getFullYear();
  const span = Math.round((to.getTime() - from.getTime()) / 86400000);
  if (span <= 1) {
    return `${fmt.format(from)} ${yf}`;
  }
  const inclusiveEnd = new Date(to);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return `${fmt.format(from)} – ${fmt.format(inclusiveEnd)} ${yf}`;
}
