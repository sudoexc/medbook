"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ClipboardListIcon,
  CheckCircle2Icon,
  RotateCwIcon,
  Clock3Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { KpiTile } from "@/components/atoms/kpi-tile";

import { useDoctorCaseStats } from "../_hooks/use-doctor-case-stats";

export interface DoctorCasesProps {
  doctorId: string;
  className?: string;
}

/**
 * Compact "Cases" card for the doctor profile. Surfaces 4 MedicalCase
 * metrics that don't fit naturally into Finances or HeatGrid.
 *
 * No period toggle here — these numbers are inherently anchored
 * (open=now, resolved=last 30d, repeat=last 90d, avg=lifetime). Adding a
 * picker would only be misleading.
 */
export function DoctorCases({ doctorId, className }: DoctorCasesProps) {
  const t = useTranslations("crmDoctors.cases");
  const q = useDoctorCaseStats(doctorId);

  const open = q.data?.openCases ?? 0;
  const resolved = q.data?.resolvedLast30d ?? 0;
  const repeat = q.data?.repeatRatePct ?? 0;
  const dur = q.data?.avgDurationDays ?? 0;

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={t("open")}
          tone="primary"
          icon={<ClipboardListIcon className="size-4" />}
          value={q.isLoading ? "—" : open}
        />
        <KpiTile
          label={t("resolved30")}
          tone="success"
          icon={<CheckCircle2Icon className="size-4" />}
          value={q.isLoading ? "—" : resolved}
        />
        <KpiTile
          label={t("repeatRate")}
          tone="info"
          icon={<RotateCwIcon className="size-4" />}
          value={q.isLoading ? "—" : t("pct", { value: repeat })}
        />
        <KpiTile
          label={t("avgDuration")}
          tone="neutral"
          icon={<Clock3Icon className="size-4" />}
          value={q.isLoading ? "—" : t("days", { value: dur })}
        />
      </div>
    </section>
  );
}
