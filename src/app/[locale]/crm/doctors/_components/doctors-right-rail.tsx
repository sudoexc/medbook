"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { StarIcon, TrendingUpIcon, ActivityIcon } from "lucide-react";

import { MoneyText } from "@/components/atoms/money-text";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAgg } from "../_hooks/use-doctors-stats";
import type { PeriodKey } from "../_hooks/use-doctors-filters";

type Top = {
  id: string;
  name: string;
  value: string | React.ReactNode;
  raw: number;
};

function parseRating(r: DoctorRow["rating"]): number {
  if (r === null || r === undefined) return 0;
  const n = typeof r === "string" ? Number(r) : Number(r);
  return Number.isFinite(n) ? n : 0;
}

export interface DoctorsRightRailProps {
  doctors: DoctorRow[];
  aggByDoctor: Map<string, DoctorAgg>;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  isLoading: boolean;
}

const PERIODS: PeriodKey[] = ["today", "week", "month", "quarter"];

export function DoctorsRightRail({
  doctors,
  aggByDoctor,
  period,
  onPeriodChange,
  isLoading,
}: DoctorsRightRailProps) {
  const t = useTranslations("crmDoctors.rail");
  const tPeriod = useTranslations("crmDoctors.period");
  const locale = useLocale();

  const aggregate = React.useMemo(() => {
    const totals = { revenue: 0, visits: 0, completed: 0 };
    for (const a of aggByDoctor.values()) {
      totals.revenue += a.revenue;
      totals.visits += a.total;
      totals.completed += a.completed;
    }
    const avgCheck = totals.completed > 0 ? Math.round(totals.revenue / totals.completed) : 0;
    return { ...totals, avgCheck };
  }, [aggByDoctor]);

  const topRevenue = React.useMemo<Top[]>(() => {
    return doctors
      .map((d) => {
        const a = aggByDoctor.get(d.id);
        const revenue = a?.revenue ?? 0;
        return {
          id: d.id,
          name: locale === "uz" ? d.nameUz : d.nameRu,
          raw: revenue,
          value: <MoneyText amount={revenue} currency="UZS" />,
        };
      })
      .filter((x) => x.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3);
  }, [doctors, aggByDoctor, locale]);

  const topRating = React.useMemo<Top[]>(() => {
    return doctors
      .map((d) => {
        const r = parseRating(d.rating);
        return {
          id: d.id,
          name: locale === "uz" ? d.nameUz : d.nameRu,
          raw: r,
          value: (
            <span className="inline-flex items-center gap-1 text-xs">
              <StarIcon className="size-3 fill-[color:var(--warning)] text-[color:var(--warning)]" />
              {r.toFixed(1)}
            </span>
          ),
        };
      })
      .filter((x) => x.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3);
  }, [doctors, locale]);

  const topLoad = React.useMemo<Top[]>(() => {
    return doctors
      .map((d) => {
        const a = aggByDoctor.get(d.id);
        const total = a?.total ?? 0;
        return {
          id: d.id,
          name: locale === "uz" ? d.nameUz : d.nameRu,
          raw: total,
          value: String(total),
        };
      })
      .filter((x) => x.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3);
  }, [doctors, aggByDoctor, locale]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("periodToggle")}
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-background p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              className={
                p === period
                  ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {tPeriod(p)}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">
          {t("title")}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("totalRevenue")}</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              <MoneyText amount={aggregate.revenue} currency="UZS" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("visitsTotal")}</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {aggregate.visits}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("avgCheck")}</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              <MoneyText amount={aggregate.avgCheck} currency="UZS" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("avgLoad")}</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {doctors.length > 0
                ? Math.round(aggregate.visits / Math.max(1, doctors.length))
                : 0}
            </dd>
          </div>
        </dl>
      </section>

      <TopBlock
        title={t("topRevenue")}
        icon={<TrendingUpIcon className="size-3.5" />}
        rows={topRevenue}
        emptyLabel={t("noData")}
        isLoading={isLoading}
      />
      <TopBlock
        title={t("topRating")}
        icon={<StarIcon className="size-3.5" />}
        rows={topRating}
        emptyLabel={t("noData")}
        isLoading={isLoading}
      />
      <TopBlock
        title={t("topLoad")}
        icon={<ActivityIcon className="size-3.5" />}
        rows={topLoad}
        emptyLabel={t("noData")}
        isLoading={isLoading}
      />
    </div>
  );
}

function TopBlock({
  title,
  icon,
  rows,
  emptyLabel,
  isLoading,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Top[];
  emptyLabel: string;
  isLoading: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((k) => (
            <div
              key={k}
              className="h-6 animate-pulse rounded-md bg-muted"
              aria-hidden
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="space-y-1.5 text-xs">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {r.name}
              </span>
              <span className="shrink-0 text-right text-muted-foreground">
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
