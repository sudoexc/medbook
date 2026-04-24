"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  LightbulbIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export function BottomRow({
  todayRows,
  warnings,
  className,
}: {
  todayRows: AppointmentRow[];
  warnings: { id: string; text: string; tone?: "warning" | "danger" }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 lg:grid-cols-3",
        className,
      )}
    >
      <SmartRecommendations />
      <DistributionChart todayRows={todayRows} />
      <WarningsCard warnings={warnings} />
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  iconClass,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-h-[200px] flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
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
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

function SmartRecommendations() {
  const t = useTranslations("reception.bottomRow");
  const items = [
    {
      id: "1",
      text: t("recInviteText"),
      meta: t("recInviteMeta"),
    },
    {
      id: "2",
      text: t("recConfirmText", { count: 14 }),
      meta: t("recConfirmMeta"),
    },
    {
      id: "3",
      text: t("recNoShowText", { count: 6 }),
      meta: t("recNoShowMeta"),
    },
  ];
  return (
    <SectionCard
      title={t("smartTitle")}
      icon={SparklesIcon}
      iconClass="bg-violet/15 text-[color:var(--violet)]"
    >
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-2.5"
          >
            <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-[color:var(--violet)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{item.text}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.meta}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function DistributionChart({ todayRows }: { todayRows: AppointmentRow[] }) {
  const t = useTranslations("reception.bottomRow");
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

  return (
    <SectionCard
      title={t("distributionTitle")}
      icon={TrendingUpIcon}
      iconClass="bg-primary/15 text-primary"
    >
      <div className="flex h-[120px] items-end justify-between gap-3">
        {buckets.map((b) => {
          const h = (b.count / b.max) * 100;
          return (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
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
    </SectionCard>
  );
}

function WarningsCard({
  warnings,
}: {
  warnings: { id: string; text: string; tone?: "warning" | "danger" }[];
}) {
  const t = useTranslations("reception.bottomRow");
  return (
    <SectionCard
      title={t("warningsTitle")}
      icon={AlertTriangleIcon}
      iconClass="bg-destructive/15 text-[color:var(--destructive)]"
    >
      {warnings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("warningsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {warnings.slice(0, 4).map((w) => (
            <li
              key={w.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 text-sm",
                w.tone === "danger"
                  ? "border-destructive/30 bg-destructive/5 text-foreground"
                  : "border-warning/30 bg-warning/5 text-foreground",
              )}
            >
              <AlertTriangleIcon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  w.tone === "danger"
                    ? "text-[color:var(--destructive)]"
                    : "text-[color:var(--warning)]",
                )}
              />
              <span className="min-w-0 flex-1">{w.text}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
