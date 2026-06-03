"use client";

/**
 * Filter toolbar for «Сегодня в зоне риска».
 *
 * Layout: one row with three controls side-by-side, plus a reset link.
 *
 *   [ 🔥 Высокий риск (8) ] [ ⌛ Не подтвердил (12) ] [ 📵 Нет связи (5) ]
 *   [ Врач: все ▾ ]  [ Сервис: все ▾ ]                  [ Сбросить · 3 ]
 *
 * The reason segment is always visible (3 fixed pills). The doctor and
 * service popovers expose multi-select + a search box; both close on outside
 * click and don't take up screen real estate when idle. The reset link
 * appears only when at least one filter is active.
 *
 * Keyboard:
 *   - `1`, `2`, `3` toggle the three reason chips when no input is focused
 *     (helpful for keyboard-first receptionists).
 *   - The popovers handle their own focus management via Radix.
 *
 * No new server calls — facets and filtered rows come from the parent's
 * `useRiskTodayFilters(rows, locale)` (see use-risk-today-filters.ts). The
 * toolbar is a pure controlled view.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  HourglassIcon,
  MessageCircleOffIcon,
  SearchIcon,
  StethoscopeIcon,
  TagIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type {
  DoctorFacet,
  ReasonFacet,
  RiskTodayFiltersApi,
  ServiceFacet,
} from "../_hooks/use-risk-today-filters";

export interface RiskTodayFiltersBarProps {
  api: RiskTodayFiltersApi;
}

export function RiskTodayFiltersBar({ api }: RiskTodayFiltersBarProps) {
  const t = useTranslations("actionCenter.dashboard.riskToday.filters");
  const tReasons = useTranslations(
    "actionCenter.dashboard.riskToday.reasons",
  );

  // Keyboard shortcuts 1/2/3 toggle reasons. We listen on `keydown` and bail
  // out when the focused element is editable — receptionists shouldn't have
  // their typing intercepted.
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const idx = e.key === "1" ? 0 : e.key === "2" ? 1 : e.key === "3" ? 2 : -1;
      if (idx === -1) return;
      const kind = api.facets.reasons[idx]?.kind;
      if (!kind) return;
      e.preventDefault();
      api.toggleReason(kind);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [api]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-2">
      {/* Reason chips — fixed 3 categories, always visible */}
      <div className="flex flex-wrap items-center gap-1.5">
        {api.facets.reasons.map((facet, idx) => (
          <ReasonChip
            key={facet.kind}
            facet={facet}
            active={api.filters.reasonKinds.includes(facet.kind)}
            onClick={() => api.toggleReason(facet.kind)}
            shortcut={idx + 1}
            label={
              facet.kind === "high_risk"
                ? t("reason.highRisk")
                : facet.kind === "unconfirmed_24h"
                  ? t("reason.unconfirmed")
                  : t("reason.noContact")
            }
            ariaLabel={
              facet.kind === "high_risk"
                ? tReasons("highRisk", { pct: 70 })
                : facet.kind === "unconfirmed_24h"
                  ? tReasons("unconfirmedSoon")
                  : tReasons("noContactNever")
            }
          />
        ))}
      </div>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      {/* Doctor popover */}
      <FacetPopover
        triggerIcon={<StethoscopeIcon className="size-3.5" />}
        triggerLabel={t("doctor.label")}
        selectedCount={api.filters.doctorIds.length}
        allLabel={t("doctor.all")}
        someLabel={t("doctor.some", {
          count: api.filters.doctorIds.length,
        })}
        searchPlaceholder={t("doctor.searchPlaceholder")}
        emptyLabel={t("doctor.empty")}
        clearLabel={t("doctor.clear")}
        items={api.facets.doctors}
        selectedIds={api.filters.doctorIds}
        onToggle={api.toggleDoctor}
        onClear={() => api.setDoctorIds([])}
      />

      {/* Service popover */}
      <FacetPopover
        triggerIcon={<TagIcon className="size-3.5" />}
        triggerLabel={t("service.label")}
        selectedCount={api.filters.serviceIds.length}
        allLabel={t("service.all")}
        someLabel={t("service.some", {
          count: api.filters.serviceIds.length,
        })}
        searchPlaceholder={t("service.searchPlaceholder")}
        emptyLabel={t("service.empty")}
        clearLabel={t("service.clear")}
        items={api.facets.services}
        selectedIds={api.filters.serviceIds}
        onToggle={api.toggleService}
        onClear={() => api.setServiceIds([])}
      />

      <div className="ml-auto flex items-center gap-1.5">
        {api.activeCount > 0 ? (
          <button
            type="button"
            onClick={() => api.reset()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("reset")}
          >
            <XIcon className="size-3.5" />
            <span>
              {t("reset")}
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold tabular-nums text-primary">
                {api.activeCount}
              </span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function ReasonChip({
  facet,
  active,
  onClick,
  shortcut,
  label,
  ariaLabel,
}: {
  facet: ReasonFacet;
  active: boolean;
  onClick: () => void;
  shortcut: number;
  label: string;
  ariaLabel: string;
}) {
  const Icon =
    facet.kind === "high_risk"
      ? AlertTriangleIcon
      : facet.kind === "unconfirmed_24h"
        ? HourglassIcon
        : MessageCircleOffIcon;

  const tone =
    facet.kind === "high_risk"
      ? active
        ? "border-destructive bg-destructive/15 text-destructive"
        : "border-border bg-card hover:border-destructive/40 hover:text-destructive"
      : facet.kind === "unconfirmed_24h"
        ? active
          ? "border-warning bg-warning/20 text-[color:var(--warning-foreground)]"
          : "border-border bg-card hover:border-warning/40"
        : active
          ? "border-[color:var(--violet)] bg-violet/15 text-[color:var(--violet)]"
          : "border-border bg-card hover:border-[color:var(--violet)]/40";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={facet.count === 0 && !active}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tone,
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          active ? "opacity-90" : "text-muted-foreground",
        )}
      >
        {facet.count}
      </span>
      <kbd
        aria-hidden
        className="ml-0.5 hidden rounded border border-border/60 bg-background px-1 text-[9px] font-medium text-muted-foreground opacity-70 sm:inline"
      >
        {shortcut}
      </kbd>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function FacetPopover({
  triggerIcon,
  triggerLabel,
  selectedCount,
  allLabel,
  someLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  items,
  selectedIds,
  onToggle,
  onClear,
}: {
  triggerIcon: React.ReactNode;
  triggerLabel: string;
  selectedCount: number;
  allLabel: string;
  someLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
  items: Array<DoctorFacet | ServiceFacet>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Focus the search field on open. Radix focuses the popover content first,
  // so we step in after the next paint to grab it without fighting the
  // primitive.
  React.useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.label.toLowerCase().includes(needle));
  }, [items, q]);

  const isAll = selectedCount === 0;
  const disabled = items.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            selectedCount > 0
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {triggerIcon}
          <span>{triggerLabel}:</span>
          <span className="font-bold">{isAll ? allLabel : someLabel}</span>
          <ChevronDownIcon className="size-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="block w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyLabel}
            </p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((it) => {
                const checked = selectedIds.includes(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onToggle(it.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => onToggle(it.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={it.label}
                      />
                      <span className="flex-1 truncate">{it.label}</span>
                      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {it.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selectedCount > 0 ? (
          <div className="flex items-center justify-between border-t border-border p-2">
            <span className="text-[11px] text-muted-foreground">
              {someLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <CheckIcon className="size-3" />
              {clearLabel}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
