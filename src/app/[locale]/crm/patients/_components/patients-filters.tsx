"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
const GENDERS = ["MALE", "FEMALE"] as const;

/**
 * Filter bar for the patients list. Writes every change straight to URL
 * state via `onChange` (parent wires it to `useSearchParams` + `router.replace`).
 * Search input is debounced (300ms) locally before bubbling up.
 */
export function PatientsFilters({
  state,
  onChange,
  onClear,
  className,
}: PatientsFiltersProps) {
  const t = useTranslations("patients");
  const [searchLocal, setSearchLocal] = React.useState(state.q ?? "");

  // Keep the local input in sync if the URL is mutated externally (e.g. clear).
  React.useEffect(() => {
    setSearchLocal(state.q ?? "");
  }, [state.q]);

  // Debounce search → URL state by 300ms.
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
    state.balance === "debt";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
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

      <Select
        value={state.segment ?? "__all"}
        onValueChange={(v) => onChange("segment", v === "__all" ? undefined : v)}
      >
        <SelectTrigger className="w-[160px]" aria-label={t("filters.segment")}>
          <SelectValue placeholder={t("filters.segmentAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.segmentAll")}</SelectItem>
          {SEGMENTS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`segment.${s.toLowerCase()}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.gender ?? "__all"}
        onValueChange={(v) => onChange("gender", v === "__all" ? undefined : v)}
      >
        <SelectTrigger className="w-[140px]" aria-label={t("filters.gender")}>
          <SelectValue placeholder={t("filters.genderAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.genderAll")}</SelectItem>
          {GENDERS.map((g) => (
            <SelectItem key={g} value={g}>
              {t(`gender.${g.toLowerCase()}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor="patients-age-min"
        >
          {t("filters.age")}
        </label>
        <Input
          id="patients-age-min"
          type="number"
          min={0}
          max={120}
          className="h-9 w-16"
          placeholder={t("filters.ageFrom")}
          value={state.ageMin ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange("ageMin", Number.isFinite(n) && e.target.value ? n : undefined);
          }}
          aria-label={t("filters.ageFrom")}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          max={120}
          className="h-9 w-16"
          placeholder={t("filters.ageTo")}
          value={state.ageMax ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange("ageMax", Number.isFinite(n) && e.target.value ? n : undefined);
          }}
          aria-label={t("filters.ageTo")}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 pl-1 text-sm">
        <Checkbox
          checked={state.balance === "debt"}
          onCheckedChange={(v) =>
            onChange("balance", v === true ? "debt" : undefined)
          }
          aria-label={t("filters.hasDebt")}
        />
        <span>{t("filters.hasDebt")}</span>
      </label>

      {hasAnyFilter ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <XIcon className="size-4" />
          {t("filters.clear")}
        </Button>
      ) : null}
    </div>
  );
}
