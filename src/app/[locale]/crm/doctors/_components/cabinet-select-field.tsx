"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, DoorOpenIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type CabinetOccupant = {
  id: string;
  nameRu: string;
  nameUz: string;
  isActive: boolean;
};

export type CabinetRow = {
  id: string;
  number: string;
  floor: number | null;
  nameRu: string | null;
  nameUz: string | null;
  isActive: boolean;
  occupant: CabinetOccupant | null;
};

export const CABINETS_WITH_OCCUPANTS_KEY = ["cabinets-with-occupants"] as const;

export interface CabinetSelectFieldProps {
  value: string;
  onChange: (cabinetId: string) => void;
  /**
   * If set, the cabinet with this id is treated as the *current* assignment:
   * always selectable (so a doctor can re-pick their own cabinet) and tagged
   * with a "current" badge. Used by the change-cabinet dialog. Leave
   * undefined for new-doctor flows where there is no incumbent.
   */
  currentCabinetId?: string;
  /** Externally disable interaction (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /**
   * Renders a compact action under the empty state (e.g. a link to
   * /settings/cabinets). Optional; the empty message is always shown.
   */
  emptyAction?: React.ReactNode;
}

/**
 * Controlled cabinet picker. Lists every active cabinet of the current
 * tenant and disables the ones occupied by *other* doctors. Loading + error
 * + empty states are surfaced inline so dialogs that embed this don't have
 * to re-implement them.
 */
export function CabinetSelectField({
  value,
  onChange,
  currentCabinetId,
  disabled = false,
  emptyAction,
}: CabinetSelectFieldProps) {
  const t = useTranslations("crmDoctors.profile");
  const locale = useLocale();

  const cabinetsQuery = useQuery<CabinetRow[], Error>({
    queryKey: CABINETS_WITH_OCCUPANTS_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetRow[] };
      return j.rows;
    },
    staleTime: 30_000,
  });

  if (cabinetsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (cabinetsQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {t("cabinetLoadError")}
      </div>
    );
  }

  const rows = cabinetsQuery.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <p>{t("cabinetEmpty")}</p>
        {emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
      </div>
    );
  }

  return (
    <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
      {rows.map((c) => {
        const isCurrent = currentCabinetId !== undefined && c.id === currentCabinetId;
        const isOccupiedByOther =
          Boolean(c.occupant) && c.occupant!.id !== currentCabinetId;
        const isOccupiedBySelf =
          Boolean(c.occupant) && currentCabinetId !== undefined && c.occupant!.id === currentCabinetId;
        const isSelected = value === c.id;
        const itemDisabled = disabled || (isOccupiedByOther && !isCurrent && !isOccupiedBySelf);
        const cabName = (locale === "uz" ? c.nameUz : c.nameRu) ?? null;
        const occupantName = c.occupant
          ? locale === "uz"
            ? c.occupant.nameUz
            : c.occupant.nameRu
          : null;
        return (
          <li key={c.id}>
            <button
              type="button"
              disabled={itemDisabled}
              onClick={() => onChange(c.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
                isSelected && "bg-primary/5",
                itemDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background",
                  isSelected && "border-primary text-primary",
                )}
              >
                {isSelected ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <DoorOpenIcon className="size-4" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  № {c.number}
                  {cabName ? (
                    <span className="ml-2 text-muted-foreground">{cabName}</span>
                  ) : null}
                  {isCurrent ? (
                    <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {t("cabinetCurrent")}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {occupantName && !isCurrent
                    ? t("cabinetOccupiedBy", { name: occupantName })
                    : t("cabinetFree")}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
