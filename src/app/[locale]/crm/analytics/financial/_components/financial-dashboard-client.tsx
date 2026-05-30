"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { MoneyText } from "@/components/atoms/money-text";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectMonthEnd } from "@/lib/analytics/dashboard-math";
import { formatClinicDateTime, type Locale } from "@/lib/format";
import type { FinancialPaceSnapshot } from "@/server/analytics/financial-pace-resolver";

const REFRESH_MS = 60_000;

export interface FinancialDashboardClientProps {
  initialSnapshot: FinancialPaceSnapshot;
}

/**
 * Financial pace dashboard — 4 KPI cards over a 90-day daily-collected
 * trend. Polls `/api/crm/analytics/financial` every 60s so admins watching
 * the page during the day see live numbers without a manual refresh.
 *
 * The projected month-end uses the shared `projectMonthEnd` helper so the
 * formula matches the cron-driven snapshots used by W4 scheduled emails.
 */
export function FinancialDashboardClient({
  initialSnapshot,
}: FinancialDashboardClientProps) {
  const t = useTranslations("analyticsFinancial");
  const locale = useLocale() as Locale;

  const [snapshot, setSnapshot] = React.useState(initialSnapshot);
  const [updatedAt, setUpdatedAt] = React.useState(initialSnapshot.generatedAt);

  // Auto-refresh — runs only while the tab is visible. Browsers throttle
  // intervals on hidden tabs, but we're explicit here so a 1h-in-the-back-
  // ground tab doesn't spam the API the moment it's brought forward.
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/crm/analytics/financial", {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: FinancialPaceSnapshot;
        };
        if (cancelled) return;
        setSnapshot(json.data);
        setUpdatedAt(json.data.generatedAt);
      } catch {
        // Stale data is preferable to a spinner that never resolves.
      }
    };
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const todayCollected = snapshot.today?.revenueCollectedTiins ?? 0;
  const todayScheduled = snapshot.today?.revenueScheduledTiins ?? 0;
  const todayNoShow = snapshot.today?.noShowLossTiins ?? 0;
  const mtdCollected = snapshot.mtd.revenueCollectedTiins;
  const projection = projectMonthEnd(mtdCollected, new Date());

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <span className="text-xs text-muted-foreground">
            {t("lastUpdated", {
              time: new Date(updatedAt).toLocaleTimeString(),
            })}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t("kpi.todayCollected")}
          subtitle={t("kpi.todayCollectedHint")}
          value={<MoneyText amount={todayCollected} currency="UZS" />}
        />
        <KpiCard
          title={t("kpi.todayScheduled")}
          subtitle={t("kpi.todayScheduledHint")}
          value={<MoneyText amount={todayScheduled} currency="UZS" />}
        />
        <KpiCard
          title={t("kpi.todayNoShow")}
          subtitle={t("kpi.todayNoShowHint")}
          tone={todayNoShow > 0 ? "danger" : undefined}
          value={<MoneyText amount={todayNoShow} currency="UZS" />}
        />
        <KpiCard
          title={t("kpi.mtdProjected")}
          subtitle={t("kpi.mtdProjectedHint", {
            day: projection.dayOfMonth,
            total: projection.daysInMonth,
          })}
          value={
            <div className="flex flex-col">
              <MoneyText amount={mtdCollected} currency="UZS" />
              <span className="text-xs font-normal text-muted-foreground">
                {t("kpi.mtdProjectedSuffix")}{" "}
                <MoneyText
                  amount={projection.projectedTiins}
                  currency="UZS"
                />
              </span>
            </div>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("trend.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("trend.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <DailyPaceChart points={snapshot.daily} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("metaHint", {
          generatedAt: formatClinicDateTime(snapshot.generatedAt, locale),
          source: snapshot.source,
        })}
      </p>
    </PageContainer>
  );
}

function KpiCard({
  title,
  subtitle,
  value,
  tone,
}: {
  title: string;
  subtitle?: string;
  value: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <Card
      className={
        tone === "danger" ? "border-destructive/30 bg-destructive/5" : undefined
      }
    >
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </div>
        {subtitle ? (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * 90-day daily-collected SVG line chart. Inline so we don't drag recharts
 * into the dashboard's first paint — the financial page is on a 60s refresh
 * and recharts is ~90 KB min+gzip even for a single line.
 */
function DailyPaceChart({
  points,
}: {
  points: FinancialPaceSnapshot["daily"];
}) {
  const t = useTranslations("analyticsFinancial.trend");
  // Filter to the last 90 days so the page-level snapshot's optional 30-day
  // forecast tail doesn't stretch the X axis.
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const cutoff = new Date(todayUtc.getTime() - 89 * 24 * 3600 * 1000);
  const filtered = points.filter((p) => {
    const d = new Date(p.day);
    return d >= cutoff && d <= todayUtc;
  });

  if (filtered.length < 2) {
    return <p className="text-xs text-muted-foreground">{t("empty")}</p>;
  }

  const w = 720;
  const h = 200;
  const padX = 36;
  const padY = 16;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const maxRev = Math.max(...filtered.map((p) => p.revenueCollectedTiins), 1);
  const stepX = filtered.length > 1 ? innerW / (filtered.length - 1) : 0;
  const path = filtered
    .map((p, i) => {
      const x = padX + i * stepX;
      const y = padY + (1 - p.revenueCollectedTiins / maxRev) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Pick ~6 evenly-spaced X-axis ticks so we don't cram 90 dates onto the
  // baseline. Ticks are taken from the actual filtered series so leap years
  // and short months don't drift the labels.
  const tickIndices = [
    0,
    Math.floor(filtered.length * 0.2),
    Math.floor(filtered.length * 0.4),
    Math.floor(filtered.length * 0.6),
    Math.floor(filtered.length * 0.8),
    filtered.length - 1,
  ];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={t("ariaLabel")}
      className="block"
    >
      <line
        x1={padX}
        y1={h - padY}
        x2={w - padX}
        y2={h - padY}
        stroke="var(--border)"
        strokeWidth={1}
      />
      <path
        d={path}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.75}
      />
      {tickIndices.map((i) => {
        const p = filtered[i];
        if (!p) return null;
        const x = padX + i * stepX;
        return (
          <g key={i}>
            <line
              x1={x}
              y1={h - padY}
              x2={x}
              y2={h - padY + 3}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={h - 2}
              fontSize="10"
              textAnchor="middle"
              fill="var(--muted-foreground)"
            >
              {p.day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
