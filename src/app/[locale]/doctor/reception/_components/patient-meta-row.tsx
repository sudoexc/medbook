"use client";

import {
  ChevronDownIcon,
  ClipboardListIcon,
  PillIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_META_CHIPS, type MetaChip } from "../_mocks";

const ICON: Record<MetaChip["icon"], LucideIcon> = {
  allergy: ShieldAlertIcon,
  chronic: ClipboardListIcon,
  medication: PillIcon,
};

const TONE: Record<MetaChip["tone"], string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function PatientMetaRow() {
  return (
    <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card px-5 py-3">
      {MOCK_META_CHIPS.map((chip) => {
        const Icon = ICON[chip.icon];
        return (
          <div key={chip.id} className="flex items-center gap-2 text-xs">
            <Icon className={cn("size-4", TONE[chip.tone])} />
            <span className="font-semibold text-foreground">{chip.label}:</span>
            <span className="text-muted-foreground">{chip.value}</span>
          </div>
        );
      })}
      <button
        type="button"
        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        Показать ещё
        <ChevronDownIcon className="size-3" />
      </button>
    </section>
  );
}
