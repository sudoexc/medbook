"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BellIcon,
  LightbulbIcon,
  RefreshCwIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";

export function BottomRow({
  todayRows,
  doctors,
  className,
}: {
  todayRows: AppointmentRow[];
  doctors: DoctorRef[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 lg:grid-cols-2",
        className,
      )}
    >
      <SmartRecommendations todayRows={todayRows} />
      <DistributionChart todayRows={todayRows} doctors={doctors} />
    </div>
  );
}

type SmartRecs = {
  redistribute: { cabinet: string; count: number } | null;
  optimize: { hour: number; dropPct: number } | null;
  remind: number;
};

function useSmartRecs(todayRows: AppointmentRow[]): SmartRecs {
  return React.useMemo(() => {
    const now = new Date();
    const cabinetCounts = new Map<string, number>();
    const hourCounts = new Map<number, number>();
    let remind = 0;

    for (const row of todayRows) {
      if (row.queueStatus === "CANCELLED" || row.queueStatus === "NO_SHOW") {
        continue;
      }
      if (row.cabinet) {
        cabinetCounts.set(
          row.cabinet.number,
          (cabinetCounts.get(row.cabinet.number) ?? 0) + 1,
        );
      }
      const start = new Date(row.date);
      const h = start.getHours();
      hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
      if (row.queueStatus === "BOOKED" && start.getTime() > now.getTime()) {
        remind += 1;
      }
    }

    // Cabinet imbalance: peak vs average.
    let redistribute: SmartRecs["redistribute"] = null;
    if (cabinetCounts.size >= 2) {
      const entries = Array.from(cabinetCounts.entries()).sort(
        (a, b) => b[1] - a[1],
      );
      const [peakCab, peakCount] = entries[0];
      const total = entries.reduce((acc, [, c]) => acc + c, 0);
      const avg = total / entries.length;
      const overflow = Math.round(peakCount - avg);
      if (overflow >= 2) {
        redistribute = { cabinet: peakCab, count: overflow };
      }
    }

    // Schedule optimization: find the first upcoming hour where load drops
    // ≥25% below the day's peak. Ignores past hours.
    let optimize: SmartRecs["optimize"] = null;
    if (hourCounts.size >= 2) {
      const maxLoad = Math.max(...Array.from(hourCounts.values()));
      const futureHours = Array.from(hourCounts.entries())
        .filter(([h]) => h >= now.getHours())
        .sort((a, b) => a[0] - b[0]);
      for (const [h, c] of futureHours) {
        const drop = (maxLoad - c) / maxLoad;
        if (drop >= 0.25) {
          optimize = { hour: h, dropPct: Math.round(drop * 100) };
          break;
        }
      }
    }

    return { redistribute, optimize, remind };
  }, [todayRows]);
}

function SectionCard({
  title,
  icon: Icon,
  iconClass,
  headerRight,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[200px] flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-lg",
              iconClass,
            )}
          >
            <Icon className="size-4" />
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </h3>
        </div>
        {headerRight ? <div className="flex items-center">{headerRight}</div> : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

type RecCardVariant = "redistribute" | "optimize" | "remind";

const REC_VARIANT_STYLES: Record<
  RecCardVariant,
  {
    surface: string;
    title: string;
    iconWrap: string;
    button: string;
  }
> = {
  redistribute: {
    surface: "bg-orange-50 dark:bg-orange-500/10 border-orange-200/60 dark:border-orange-500/20",
    title: "text-orange-600 dark:text-orange-400",
    iconWrap: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    button:
      "bg-orange-600 text-white hover:bg-orange-600/90 focus-visible:outline-orange-600",
  },
  optimize: {
    surface: "bg-violet-50 dark:bg-violet-500/10 border-violet-200/60 dark:border-violet-500/20",
    title: "text-violet-600 dark:text-violet-400",
    iconWrap: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    button:
      "bg-violet-600 text-white hover:bg-violet-600/90 focus-visible:outline-violet-600",
  },
  remind: {
    surface: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-500/20",
    title: "text-emerald-600 dark:text-emerald-400",
    iconWrap: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    button:
      "bg-emerald-600 text-white hover:bg-emerald-600/90 focus-visible:outline-emerald-600",
  },
};

function RecCard({
  variant,
  icon: Icon,
  title,
  body,
  cta,
  onClick,
}: {
  variant: RecCardVariant;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  const styles = REC_VARIANT_STYLES[variant];
  return (
    <article
      className={cn(
        "motion-rise-in motion-hover-lift flex min-h-[150px] flex-col gap-3 rounded-xl border p-3",
        styles.surface,
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            styles.iconWrap,
          )}
        >
          <Icon className="size-4" />
        </span>
        <h4 className={cn("text-sm font-semibold", styles.title)}>{title}</h4>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-foreground/80">
        {body}
      </p>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "motion-press inline-flex h-8 items-center justify-center self-end rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          styles.button,
        )}
      >
        {cta}
      </button>
    </article>
  );
}

function SmartRecommendations({
  todayRows,
}: {
  todayRows: AppointmentRow[];
}) {
  const t = useTranslations("reception.bottomRow");
  const router = useRouter();
  const locale = useLocale();
  const recs = useSmartRecs(todayRows);

  const cards: React.ReactNode[] = [];

  if (recs.redistribute) {
    const { cabinet, count } = recs.redistribute;
    cards.push(
      <RecCard
        key="redistribute"
        variant="redistribute"
        icon={RefreshCwIcon}
        title={t("recRedistributeTitle")}
        body={t("recRedistributeBody", { cabinet, count })}
        cta={t("recApply")}
        onClick={() => {
          toast.info(t("recRedistributeTitle"), {
            description: t("recRedistributeBody", { cabinet, count }),
          });
          router.push(`/${locale}/crm/calendar`);
        }}
      />,
    );
  }

  if (recs.optimize) {
    const { hour, dropPct } = recs.optimize;
    cards.push(
      <RecCard
        key="optimize"
        variant="optimize"
        icon={LightbulbIcon}
        title={t("recOptimizeTitle")}
        body={t("recOptimizeBody", { hour, pct: dropPct })}
        cta={t("recView")}
        onClick={() => {
          router.push(`/${locale}/crm/calendar`);
        }}
      />,
    );
  }

  if (recs.remind > 0) {
    cards.push(
      <RecCard
        key="remind"
        variant="remind"
        icon={BellIcon}
        title={t("recRemindTitle")}
        body={t("recRemindBody", { count: recs.remind })}
        cta={t("recSend")}
        onClick={() => {
          router.push(`/${locale}/crm/action-center`);
        }}
      />,
    );
  }

  return (
    <SectionCard
      title={t("smartTitle")}
      icon={SparklesIcon}
      iconClass="bg-violet-500/15 text-violet-600 dark:text-violet-400"
    >
      {cards.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          {t("recEmpty")}
        </p>
      ) : (
        <div
          className={cn(
            "motion-stagger grid grid-cols-1 gap-3",
            cards.length === 1 && "md:grid-cols-1",
            cards.length === 2 && "md:grid-cols-2",
            cards.length === 3 && "md:grid-cols-3",
          )}
        >
          {cards}
        </div>
      )}
    </SectionCard>
  );
}

type DistributionMode = "bySpecialty" | "byTime";

const SPECIALTY_BAR_COLORS = [
  "bg-red-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-slate-400",
];

function DistributionChart({
  todayRows,
  doctors,
}: {
  todayRows: AppointmentRow[];
  doctors: DoctorRef[];
}) {
  const t = useTranslations("reception.bottomRow");
  const locale = useLocale();
  const [mode, setMode] = React.useState<DistributionMode>("bySpecialty");

  // Bucket today's appointments into 3-hour blocks (08-11, 11-14, 14-17, 17-20).
  const buckets = React.useMemo(() => {
    const counts = [0, 0, 0, 0];
    const labels = ["08-11", "11-14", "14-17", "17-20"];
    for (const row of todayRows) {
      const h = new Date(row.date).getHours();
      if (h >= 8 && h < 11) counts[0]++;
      else if (h >= 11 && h < 14) counts[1]++;
      else if (h >= 14 && h < 17) counts[2]++;
      else if (h >= 17 && h < 20) counts[3]++;
    }
    const max = Math.max(1, ...counts);
    return labels.map((label, i) => ({ label, count: counts[i], max }));
  }, [todayRows]);

  // Group by doctor specialization for bySpecialty mode.
  const specialties = React.useMemo(() => {
    if (todayRows.length === 0) return { rows: [], total: 0, max: 0 };
    const doctorById = new Map<string, DoctorRef>();
    for (const d of doctors) doctorById.set(d.id, d);

    const counts = new Map<string, number>();
    for (const row of todayRows) {
      const doctor = doctorById.get(row.doctor.id);
      const label =
        (locale === "uz"
          ? doctor?.specializationUz
          : doctor?.specializationRu) ?? t("distributionOther");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const total = todayRows.length;
    const sorted = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    if (rest.length > 0) {
      const otherCount = rest.reduce((acc, x) => acc + x.count, 0);
      const otherLabel = t("distributionOther");
      const existing = top.find((r) => r.label === otherLabel);
      if (existing) {
        existing.count += otherCount;
      } else {
        top.push({ label: otherLabel, count: otherCount });
      }
    }

    const max = Math.max(1, ...top.map((r) => r.count));
    return { rows: top, total, max };
  }, [todayRows, doctors, locale, t]);

  const toggle = (
    <div
      role="tablist"
      aria-label={t("distributionTitle")}
      className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "bySpecialty"}
        onClick={() => setMode("bySpecialty")}
        className={cn(
          "rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors",
          mode === "bySpecialty"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {t("distributionBySpecialty")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "byTime"}
        onClick={() => setMode("byTime")}
        className={cn(
          "rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors",
          mode === "byTime"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {t("distributionByTime")}
      </button>
    </div>
  );

  return (
    <SectionCard
      title={t("distributionTitle")}
      icon={TrendingUpIcon}
      iconClass="bg-primary/15 text-primary"
      headerRight={toggle}
    >
      {mode === "byTime" ? (
        <div className="flex h-[120px] items-end justify-between gap-3">
          {buckets.map((b) => {
            const h = (b.count / b.max) * 100;
            return (
              <div
                key={b.label}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <span className="text-[11px] font-semibold text-foreground tabular-nums">
                  {b.count}
                </span>
                <div className="flex h-[80px] w-full items-end">
                  <div
                    className="w-full rounded-md bg-gradient-to-t from-primary to-primary/60 transition-all"
                    style={{ height: `${Math.max(6, h)}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      ) : specialties.rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("distributionEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {specialties.rows.map((row, i) => {
            const widthPct = (row.count / specialties.max) * 100;
            const sharePct =
              specialties.total > 0
                ? Math.round((row.count / specialties.total) * 100)
                : 0;
            const colorClass =
              SPECIALTY_BAR_COLORS[i % SPECIALTY_BAR_COLORS.length];
            return (
              <li key={row.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-foreground">
                    {row.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {sharePct}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", colorClass)}
                    style={{ width: `${Math.max(4, widthPct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
