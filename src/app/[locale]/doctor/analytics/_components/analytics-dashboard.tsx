"use client";

/**
 * Phase G8 — doctor analytics dashboard.
 *
 * Single-shot fetch of `/api/crm/doctors/me/analytics` with a date-range
 * toggle (7 / 30 / 90 days or a custom from/to). KPI tiles render the
 * counters straight from the response; a compact bar group visualises the
 * daily Rx/SL/lab/override volumes side-by-side. Kept dependency-free —
 * no chart libraries — so the bundle doesn't grow for a single screen.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PillIcon,
  RefreshCwIcon,
  ScrollIcon,
  ShieldAlertIcon,
  StethoscopeIcon,
  TrendingUpIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  useDoctorAnalytics,
  type DoctorAnalyticsDaily,
} from "../_hooks/use-doctor-analytics";

type Preset = { days: number };

const PRESETS: Preset[] = [
  { days: 7 },
  { days: 30 },
  { days: 90 },
];

function todayYMD(): string {
  return toYMD(new Date());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromPreset(days: number): { from: string; to: string } {
  const to = new Date();
  const from = addDays(to, -(days - 1));
  return { from: toYMD(from), to: toYMD(to) };
}

export function AnalyticsDashboard() {
  const t = useTranslations("doctor.analytics");
  const [presetDays, setPresetDays] = React.useState<number | null>(30);
  const [customFrom, setCustomFrom] = React.useState<string>(() =>
    toYMD(addDays(new Date(), -29)),
  );
  const [customTo, setCustomTo] = React.useState<string>(() => todayYMD());

  const range = presetDays ? fromPreset(presetDays) : { from: customFrom, to: customTo };
  const query = useDoctorAnalytics({ from: range.from, to: range.to });

  const data = query.data;
  const isFetching = query.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <RangeToolbar
        presetDays={presetDays}
        onPickPreset={(d) => setPresetDays(d)}
        customFrom={customFrom}
        customTo={customTo}
        onCustomChange={(f, t) => {
          setCustomFrom(f);
          setCustomTo(t);
        }}
        onUseCustom={() => setPresetDays(null)}
        onRefresh={() => query.refetch()}
        isFetching={isFetching}
        rangeLabel={data ? `${data.range.from} → ${data.range.to}` : null}
      />

      {query.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {t("dashboard.loadError", {
            message: (query.error as Error)?.message ?? t("dashboard.errorFallback"),
          })}
        </div>
      )}

      {!data && query.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {t("dashboard.computing")}
        </div>
      )}

      {data && (
        <>
          <KpiGrid kpis={data.kpis} />
          <DailyVolumeCard daily={data.daily} />
          <p className="text-[11px] text-muted-foreground">
            {t("dashboard.footnote")}
          </p>
        </>
      )}
    </div>
  );
}

function RangeToolbar({
  presetDays,
  onPickPreset,
  customFrom,
  customTo,
  onCustomChange,
  onUseCustom,
  onRefresh,
  isFetching,
  rangeLabel,
}: {
  presetDays: number | null;
  onPickPreset: (days: number) => void;
  customFrom: string;
  customTo: string;
  onCustomChange: (from: string, to: string) => void;
  onUseCustom: () => void;
  onRefresh: () => void;
  isFetching: boolean;
  rangeLabel: string | null;
}) {
  const t = useTranslations("doctor.analytics");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2">
      <div className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarRangeIcon className="size-3" />
        {t("toolbar.period")}
      </div>
      {PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => onPickPreset(p.days)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors",
            presetDays === p.days
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted/60",
          )}
        >
          {t("toolbar.presetDays", { days: p.days })}
        </button>
      ))}
      <div className="flex items-center gap-1 text-xs">
        <input
          type="date"
          value={customFrom}
          onChange={(e) => {
            onCustomChange(e.target.value, customTo);
            onUseCustom();
          }}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          value={customTo}
          onChange={(e) => {
            onCustomChange(customFrom, e.target.value);
            onUseCustom();
          }}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
        />
      </div>
      {rangeLabel && (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {rangeLabel}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-xs"
        onClick={onRefresh}
        disabled={isFetching}
      >
        <RefreshCwIcon
          className={cn("size-3.5", isFetching && "animate-spin")}
        />
        {t("toolbar.refresh")}
      </Button>
    </div>
  );
}

type KpiTile = {
  label: string;
  value: number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "neutral" | "good" | "warn";
};

function KpiGrid({
  kpis,
}: {
  kpis: {
    completedAppointments: number;
    finalizedNotes: number;
    protocolApplied: number;
    protocolAppliedPct: number;
    rxIssued: number;
    slIssued: number;
    labOrdersIssued: number;
    cdsOverrides: number;
    labResultsReviewed: number;
  };
}) {
  const t = useTranslations("doctor.analytics");
  const tiles: KpiTile[] = [
    {
      label: t("kpi.completedAppointments"),
      value: kpis.completedAppointments,
      icon: StethoscopeIcon,
      tone: "neutral",
    },
    {
      label: t("kpi.finalizedNotes"),
      value: kpis.finalizedNotes,
      icon: FileTextIcon,
      tone: "neutral",
    },
    {
      label: t("kpi.protocolApplied"),
      value: kpis.protocolApplied,
      hint: t("kpi.protocolAppliedHint", { pct: kpis.protocolAppliedPct }),
      icon: ClipboardCheckIcon,
      tone: "good",
    },
    {
      label: t("kpi.rxIssued"),
      value: kpis.rxIssued,
      icon: PillIcon,
      tone: "neutral",
    },
    {
      label: t("kpi.slIssued"),
      value: kpis.slIssued,
      icon: ScrollIcon,
      tone: "neutral",
    },
    {
      label: t("kpi.labOrdersIssued"),
      value: kpis.labOrdersIssued,
      icon: FlaskConicalIcon,
      tone: "neutral",
    },
    {
      label: t("kpi.labResultsReviewed"),
      value: kpis.labResultsReviewed,
      icon: ActivityIcon,
      tone: "good",
    },
    {
      label: t("kpi.cdsOverrides"),
      value: kpis.cdsOverrides,
      hint:
        kpis.cdsOverrides > 0
          ? t("kpi.cdsOverridesPresent")
          : t("kpi.cdsOverridesNone"),
      icon: ShieldAlertIcon,
      tone: kpis.cdsOverrides > 0 ? "warn" : "good",
    },
  ];

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </ul>
  );
}

function Tile({ label, value, hint, icon: Icon, tone }: KpiTile) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card p-3",
        tone === "warn" && "border-amber-300 bg-amber-50/60",
        tone === "good" && "border-emerald-200 bg-emerald-50/40",
        tone === "neutral" && "border-border",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          tone === "warn" && "bg-amber-100 text-amber-700",
          tone === "good" && "bg-emerald-100 text-emerald-700",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1">
        <div className="text-2xl font-semibold tabular-nums leading-none text-foreground">
          {value.toLocaleString("ru-RU")}
        </div>
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">
          {label}
        </div>
        {hint && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/80">{hint}</div>
        )}
      </div>
    </li>
  );
}

function DailyVolumeCard({ daily }: { daily: DoctorAnalyticsDaily[] }) {
  const peak = React.useMemo(() => {
    let p = 0;
    for (const d of daily) {
      p = Math.max(p, d.rx + d.sl + d.labs + d.overrides);
    }
    return p;
  }, [daily]);

  const t = useTranslations("doctor.analytics");

  if (daily.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <TrendingUpIcon className="size-3.5 text-muted-foreground" />
        <div className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {t("daily.title")}
        </div>
        <Legend />
      </div>
      <div className="mt-2 grid grid-flow-col auto-cols-fr gap-1 overflow-x-auto">
        {daily.map((d) => (
          <DayColumn key={d.date} day={d} peak={peak} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ day, peak }: { day: DoctorAnalyticsDaily; peak: number }) {
  const t = useTranslations("doctor.analytics");
  const total = day.rx + day.sl + day.labs + day.overrides;
  const heightPct = (n: number) => (peak > 0 ? Math.round((n / peak) * 100) : 0);

  const dayLabel = day.date.slice(8); // "DD"
  return (
    <div
      className="group flex flex-col items-center gap-0.5"
      title={tooltip(day, {
        rx: t("daily.legendRx"),
        sl: t("daily.legendSl"),
        labs: t("daily.legendLabs"),
        overrides: t("daily.legendOverride"),
      })}
    >
      <div className="flex h-16 w-full items-end gap-px">
        <Bar pct={heightPct(day.rx)} color="bg-sky-400" />
        <Bar pct={heightPct(day.sl)} color="bg-amber-400" />
        <Bar pct={heightPct(day.labs)} color="bg-emerald-400" />
        <Bar pct={heightPct(day.overrides)} color="bg-red-400" />
      </div>
      <div
        className={cn(
          "text-[9px] tabular-nums text-muted-foreground",
          total === 0 && "opacity-50",
        )}
      >
        {dayLabel}
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex h-full flex-1 items-end">
      <div
        className={cn("w-full rounded-t-sm", color)}
        style={{ height: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
      />
    </div>
  );
}

function tooltip(
  day: DoctorAnalyticsDaily,
  labels: { rx: string; sl: string; labs: string; overrides: string },
): string {
  return (
    `${day.date}` +
    ` · ${labels.rx}: ${day.rx}` +
    ` · ${labels.sl}: ${day.sl}` +
    ` · ${labels.labs}: ${day.labs}` +
    ` · ${labels.overrides}: ${day.overrides}`
  );
}

function Legend() {
  const t = useTranslations("doctor.analytics");
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
      <LegendDot color="bg-sky-400" label={t("daily.legendRx")} />
      <LegendDot color="bg-amber-400" label={t("daily.legendSl")} />
      <LegendDot color="bg-emerald-400" label={t("daily.legendLabs")} />
      <LegendDot color="bg-red-400" label={t("daily.legendOverride")} />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className={cn("inline-block size-2 rounded-sm", color)} />
      {label}
    </div>
  );
}
