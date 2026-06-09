"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  useDoctorPatientSegments,
  type Segment,
  type SegmentKey,
} from "../_hooks/use-doctor-patient-segments";

const COLOR: Record<SegmentKey, string> = {
  active: "var(--success)",
  watch: "var(--info)",
  dormant: "var(--muted-foreground)",
  new: "var(--primary)",
  returned: "var(--warning)",
};

const DOT: Record<SegmentKey, string> = {
  active: "bg-success",
  watch: "bg-info",
  dormant: "bg-muted-foreground",
  new: "bg-primary",
  returned: "bg-warning",
};

const SIZE = 96;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Header({
  activeTab,
  onClear,
}: {
  activeTab?: SegmentKey | null;
  onClear?: () => void;
}) {
  const t = useTranslations("doctor.patients");
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-[15px] font-semibold text-foreground">
        {t("segmentation.title")}
      </span>
      {activeTab && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("segmentation.reset")}
        </button>
      ) : null}
    </div>
  );
}

export function SegmentationCard() {
  const t = useTranslations("doctor.patients");
  const { data, isLoading, isError } = useDoctorPatientSegments();
  const { filters, setTab } = usePatientsFilters();
  const activeTab: SegmentKey | null =
    filters.tab && filters.tab !== "all" ? (filters.tab as SegmentKey) : null;

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="flex items-center gap-4">
          <div
            className="shrink-0 animate-pulse rounded-full bg-muted"
            style={{ width: SIZE, height: SIZE }}
          />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-muted" />
                <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
                <span className="h-3 w-12 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">{t("segmentation.totalPatients")}</span>
          <span className="h-3 w-8 animate-pulse rounded bg-muted" />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="py-6 text-center text-xs text-destructive">
          {t("segmentation.loadError")}
        </div>
      </section>
    );
  }

  if (data.total === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="flex items-center gap-4">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0 -rotate-90"
            aria-hidden
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--border)"
              strokeWidth={STROKE}
            />
          </svg>
          <p className="text-xs text-muted-foreground">
            {t("segmentation.empty")}
          </p>
        </div>
      </section>
    );
  }

  // Build arc geometry. Each arc starts where the previous one left off so
  // they ring around the donut without overlap.
  let offset = 0;
  const arcs = data.segments
    .filter((s) => s.count > 0)
    .map((s: Segment) => {
      const len = (s.percent / 100) * CIRCUMFERENCE;
      const arc = { key: s.key, length: len, offset };
      offset += len;
      return arc;
    });

  const toggle = (key: SegmentKey, count: number) => {
    if (count === 0) return; // nothing to filter into — keep the click inert
    setTab(activeTab === key ? "all" : key);
  };

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <Header
        activeTab={activeTab}
        onClear={activeTab ? () => setTab("all") : undefined}
      />

      <div className="flex items-center gap-4">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="shrink-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE}
          />
          {arcs.map((a) => {
            const dim = activeTab !== null && activeTab !== a.key;
            return (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={COLOR[a.key]}
                strokeWidth={STROKE}
                strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
                strokeDashoffset={-a.offset}
                opacity={dim ? 0.3 : 1}
              />
            );
          })}
        </svg>

        <ul className="min-w-0 flex-1 space-y-1">
          {data.segments.map((s) => {
            const isActive = activeTab === s.key;
            const disabled = s.count === 0;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => toggle(s.key, s.count)}
                  disabled={disabled}
                  aria-pressed={isActive}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
                    !disabled && "hover:bg-muted/60",
                    isActive && "bg-muted",
                    disabled && "cursor-default opacity-60",
                  )}
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", DOT[s.key])}
                  />
                  <span className="flex-1 truncate text-foreground">
                    {s.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {s.count} ({s.percent}%)
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">{t("segmentation.totalPatients")}</span>
        <span className="font-semibold text-foreground tabular-nums">
          {data.total.toLocaleString("ru-RU").replace(",", " ")}
        </span>
      </div>
    </section>
  );
}
