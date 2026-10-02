"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { usePatientsStats } from "../_hooks/use-patients-stats";
import type {
  PatientRow,
  PatientSegmentCounts,
} from "../_hooks/use-patients-list";

export interface PatientsRightRailProps {
  rows: PatientRow[];
  segmentCounts: PatientSegmentCounts | null;
  activeSegment?: PatientRow["segment"];
  onSelectSegment: (segment: PatientRow["segment"] | undefined) => void;
}

const SourcesWidget = dynamic(
  () => import("./sources-widget").then((m) => m.SourcesWidget),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-border bg-card p-3">
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  },
);

type SegmentRowDef = {
  key: PatientRow["segment"];
  labelKey: string;
  dotClass: string;
};

const SEGMENT_ROWS: SegmentRowDef[] = [
  { key: "VIP", labelKey: "segments.vip", dotClass: "bg-destructive" },
  { key: "NEW", labelKey: "segments.newClients", dotClass: "bg-warning" },
  { key: "ACTIVE", labelKey: "segments.active", dotClass: "bg-success" },
  { key: "DORMANT", labelKey: "segments.dormant", dotClass: "bg-info" },
  { key: "CHURN", labelKey: "segments.churn", dotClass: "bg-destructive/70" },
];

export function PatientsRightRail({
  rows,
  segmentCounts,
  activeSegment,
  onSelectSegment,
}: PatientsRightRailProps) {
  const t = useTranslations("patients.rail");
  const locale = useLocale();
  const { data: stats, isLoading } = usePatientsStats();

  const segments = React.useMemo(() => {
    if (segmentCounts) {
      return {
        VIP: segmentCounts.VIP,
        NEW: segmentCounts.NEW,
        ACTIVE: segmentCounts.ACTIVE,
        DORMANT: segmentCounts.DORMANT,
        CHURN: segmentCounts.CHURN,
      };
    }
    const count = { VIP: 0, NEW: 0, ACTIVE: 0, DORMANT: 0, CHURN: 0 };
    for (const p of rows) {
      if (p.segment === "VIP") count.VIP += 1;
      if (p.segment === "NEW") count.NEW += 1;
      if (p.segment === "ACTIVE") count.ACTIVE += 1;
      if (p.segment === "DORMANT") count.DORMANT += 1;
      if (p.segment === "CHURN") count.CHURN += 1;
    }
    return count;
  }, [rows, segmentCounts]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(n);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* The three action cards here were a mock: their counts were the
          DORMANT / NEW / VIP+DORMANT segment sizes under captions that did
          not match them, and neither the cards nor this button opened
          anything (audit UX-15). The real worklist is the Action Center. */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("actionsHeading")}
        </h3>
        <Link
          href={`/${locale}/crm/action-center`}
          className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-primary hover:bg-primary/5"
        >
          {t("viewAllActions")}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("segmentsHeading")}
        </h3>
        <ul className="space-y-1">
          {SEGMENT_ROWS.map((row) => {
            const isActive = activeSegment === row.key;
            const count = segments[row.key];
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() =>
                    onSelectSegment(isActive ? undefined : row.key)
                  }
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/40",
                    isActive && "bg-primary/5 ring-1 ring-primary/40",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block size-2 shrink-0 rounded-full",
                      row.dotClass,
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-foreground">
                    {t(row.labelKey as never)}
                  </span>
                  <span className="ml-auto tabular-nums font-semibold text-foreground">
                    {fmt(count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {/* No «Все сегменты»: the list above is every segment, each row
            filters the table, and there is no segments index page. */}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sourcesHeading")}
        </h3>
        <SourcesWidget stats={stats} isLoading={isLoading} />
      </section>
    </div>
  );
}
