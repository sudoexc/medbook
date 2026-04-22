"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
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

import type { AppointmentsFilterState } from "../_hooks/use-appointments-filters";

const CHANNELS = ["WALKIN", "PHONE", "TELEGRAM", "WEBSITE", "KIOSK"] as const;

export interface AppointmentsFiltersProps {
  state: AppointmentsFilterState;
  onChange: <K extends keyof AppointmentsFilterState>(
    key: K,
    value: AppointmentsFilterState[K] | undefined,
  ) => void;
  onClear: () => void;
  className?: string;
}

type DoctorOption = {
  id: string;
  nameRu: string;
  nameUz: string;
};

type ServiceOption = {
  id: string;
  nameRu: string;
  nameUz: string;
};

type CabinetOption = {
  id: string;
  number: string;
};

function useDoctorOptions() {
  return useQuery<DoctorOption[], Error>({
    queryKey: ["doctors", "options"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

function useServiceOptions() {
  return useQuery<ServiceOption[], Error>({
    queryKey: ["services", "options"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

function useCabinetOptions() {
  return useQuery<CabinetOption[], Error>({
    queryKey: ["cabinets", "options"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

export function AppointmentsFilters({
  state,
  onChange,
  onClear,
  className,
}: AppointmentsFiltersProps) {
  const t = useTranslations("appointments");
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

  const doctors = useDoctorOptions();
  const services = useServiceOptions();
  const cabinets = useCabinetOptions();

  const currentDateMode = state.dateMode ?? "today";

  const hasAnyFilter =
    Boolean(state.q) ||
    Boolean(state.doctorId) ||
    Boolean(state.serviceId) ||
    Boolean(state.cabinetId) ||
    Boolean(state.channel) ||
    Boolean(state.status) ||
    Boolean(state.onlyUnpaid) ||
    (state.dateMode && state.dateMode !== "today") ||
    Boolean(state.from) ||
    Boolean(state.to);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
        className,
      )}
    >
      {/* Date mode pills */}
      <div
        role="radiogroup"
        className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
      >
        {(["today", "week", "month", "range"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={currentDateMode === m}
            onClick={() => onChange("dateMode", m)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              currentDateMode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`filters.dateMode.${m}`)}
          </button>
        ))}
      </div>

      {currentDateMode === "range" ? (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={state.from ? state.from.slice(0, 10) : ""}
            onChange={(e) =>
              onChange(
                "from",
                e.target.value
                  ? new Date(e.target.value).toISOString()
                  : undefined,
              )
            }
            aria-label={t("filters.from")}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={state.to ? state.to.slice(0, 10) : ""}
            onChange={(e) => {
              if (!e.target.value) {
                onChange("to", undefined);
                return;
              }
              const d = new Date(e.target.value);
              d.setHours(23, 59, 59, 999);
              onChange("to", d.toISOString());
            }}
            aria-label={t("filters.to")}
          />
        </div>
      ) : null}

      <div className="relative min-w-[200px] flex-1">
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
        value={state.doctorId ?? "__all"}
        onValueChange={(v) =>
          onChange("doctorId", v === "__all" ? undefined : v)
        }
      >
        <SelectTrigger
          className="w-[180px]"
          aria-label={t("filters.doctor")}
        >
          <SelectValue placeholder={t("filters.doctorAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.doctorAll")}</SelectItem>
          {(doctors.data ?? []).map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.nameRu}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.serviceId ?? "__all"}
        onValueChange={(v) =>
          onChange("serviceId", v === "__all" ? undefined : v)
        }
      >
        <SelectTrigger
          className="w-[180px]"
          aria-label={t("filters.service")}
        >
          <SelectValue placeholder={t("filters.serviceAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.serviceAll")}</SelectItem>
          {(services.data ?? []).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.nameRu}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.cabinetId ?? "__all"}
        onValueChange={(v) =>
          onChange("cabinetId", v === "__all" ? undefined : v)
        }
      >
        <SelectTrigger
          className="w-[140px]"
          aria-label={t("filters.cabinet")}
        >
          <SelectValue placeholder={t("filters.cabinetAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.cabinetAll")}</SelectItem>
          {(cabinets.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              №{c.number}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.channel ?? "__all"}
        onValueChange={(v) =>
          onChange("channel", v === "__all" ? undefined : v)
        }
      >
        <SelectTrigger
          className="w-[140px]"
          aria-label={t("filters.channel")}
        >
          <SelectValue placeholder={t("filters.channelAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t("filters.channelAll")}</SelectItem>
          {CHANNELS.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`channel.${c.toLowerCase()}` as never)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex cursor-pointer items-center gap-2 pl-1 text-sm">
        <Checkbox
          checked={Boolean(state.onlyUnpaid)}
          onCheckedChange={(v) =>
            onChange("onlyUnpaid", v === true ? true : undefined)
          }
          aria-label={t("filters.onlyUnpaid")}
        />
        <span>{t("filters.onlyUnpaid")}</span>
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
