"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface UrgentAlert {
  id: string;
  text: string;
  tone?: "warning" | "danger";
}

export interface UrgentAlertsWidgetProps {
  alerts: UrgentAlert[];
  className?: string;
}

/**
 * "Срочные оповещения" / "Shoshilinch ogohlantirishlar".
 *
 * Right-rail widget rendered under the Telegram preview on /crm/reception.
 * Replaces the former bottom-row WarningsCard.
 */
export function UrgentAlertsWidget({
  alerts,
  className,
}: UrgentAlertsWidgetProps) {
  const t = useTranslations("reception.urgentAlerts");
  const locale = useLocale();
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-destructive/30 bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <AlertTriangleIcon className="size-4" />
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t("title")}
          </h3>
        </div>
        {alerts.length > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
            {alerts.length}
          </span>
        ) : null}
      </header>
      <div className="flex-1 p-3">
        {alerts.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.slice(0, 4).map((a) => (
              <li key={a.id}>
                <Link
                  href={`?ap=${a.id}`}
                  scroll={false}
                  className={cn(
                    "group flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    a.tone === "danger"
                      ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                      : "border-warning/30 bg-warning/5 hover:bg-warning/10",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-block size-1.5 shrink-0 rounded-full",
                      a.tone === "danger" ? "bg-destructive" : "bg-warning",
                    )}
                  />
                  <span className="min-w-0 flex-1 text-foreground">
                    {a.text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {alerts.length > 0 ? (
        <Link
          href={`/${locale}/crm/notifications`}
          className="block border-t border-destructive/30 px-4 py-2.5 text-center text-[11px] font-semibold text-destructive hover:bg-destructive/5"
        >
          {t("viewAll")}
        </Link>
      ) : null}
    </section>
  );
}

export default UrgentAlertsWidget;
