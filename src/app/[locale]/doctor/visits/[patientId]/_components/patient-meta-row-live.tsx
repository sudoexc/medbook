"use client";

import {
  ChevronDownIcon,
  ClipboardListIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type Allergy = { substance: string; severity: string };

type Props = {
  allergies: Allergy[];
  chronicConditions: string[];
};

export function PatientMetaRowLive({ allergies, chronicConditions }: Props) {
  const t = useTranslations("doctor.visits");
  const allergyText =
    allergies.length === 0
      ? t("meta.notSpecified")
      : allergies.map((a) => a.substance).join(", ");
  const allergyTone =
    allergies.length === 0
      ? "text-muted-foreground"
      : allergies.some((a) => a.severity === "SEVERE")
        ? "text-destructive"
        : "text-warning";

  const chronicText =
    chronicConditions.length === 0
      ? t("meta.notSpecified")
      : chronicConditions.join(", ");
  const chronicTone =
    chronicConditions.length === 0 ? "text-muted-foreground" : "text-warning";

  return (
    <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card px-5 py-3">
      <div className="flex items-center gap-2 text-xs">
        <ShieldAlertIcon className={cn("size-4", allergyTone)} />
        <span className="font-semibold text-foreground">{t("meta.allergies")}</span>
        <span className="text-muted-foreground">{allergyText}</span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <ClipboardListIcon className={cn("size-4", chronicTone)} />
        <span className="font-semibold text-foreground">{t("meta.chronic")}</span>
        <span className="text-muted-foreground">{chronicText}</span>
      </div>

      <button
        type="button"
        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        {t("meta.showMore")}
        <ChevronDownIcon className="size-3" />
      </button>
    </section>
  );
}
