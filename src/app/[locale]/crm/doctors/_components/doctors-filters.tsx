"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type {
  DoctorsFilterState,
  DoctorsSort,
} from "../_hooks/use-doctors-filters";

export interface DoctorsFiltersProps {
  state: DoctorsFilterState;
  specializations: string[];
  onChange: <K extends keyof DoctorsFilterState>(
    key: K,
    value: DoctorsFilterState[K] | undefined,
  ) => void;
  onClear: () => void;
  className?: string;
}

const SORTS: DoctorsSort[] = ["name", "rating", "load", "revenue"];

/**
 * Filter bar for `/crm/doctors`. Search, specialization, active toggle, sort.
 * Writes every change to URL via `onChange` (parent wires it to `router.replace`).
 */
export function DoctorsFilters({
  state,
  specializations,
  onChange,
  onClear,
  className,
}: DoctorsFiltersProps) {
  const t = useTranslations("crmDoctors.filters");
  const [local, setLocal] = React.useState(state.q ?? "");

  React.useEffect(() => {
    setLocal(state.q ?? "");
  }, [state.q]);

  React.useEffect(() => {
    const current = state.q ?? "";
    if (local === current) return;
    const id = window.setTimeout(() => {
      onChange("q", local || undefined);
    }, 300);
    return () => window.clearTimeout(id);
  }, [local, state.q, onChange]);

  const hasAny =
    Boolean(state.q) ||
    Boolean(state.specialization) ||
    state.onlyActive === true ||
    Boolean(state.sort);

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
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={t("search")}
          className="pl-8"
          aria-label={t("search")}
        />
      </div>

      <Select
        value={state.specialization ?? "__all"}
        onValueChange={(v) =>
          onChange("specialization", v === "__all" ? undefined : v)
        }
      >
        <SelectTrigger
          className="w-[200px]"
          aria-label={t("specialization")}
        >
          <SelectValue placeholder={t("specializationAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("specializationAll")}</SelectItem>
          {specializations.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.sort ?? "name"}
        onValueChange={(v) => onChange("sort", v as DoctorsSort)}
      >
        <SelectTrigger className="w-[180px]" aria-label={t("sort")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`sort${s.charAt(0).toUpperCase()}${s.slice(1)}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex cursor-pointer items-center gap-2 pl-1 text-sm">
        <Checkbox
          checked={state.onlyActive === true}
          onCheckedChange={(v) =>
            onChange("onlyActive", v === true ? true : undefined)
          }
          aria-label={t("onlyActive")}
        />
        <span>{t("onlyActive")}</span>
      </label>

      {hasAny ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <XIcon className="size-4" />
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
