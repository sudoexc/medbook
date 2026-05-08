"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarRangeIcon,
  CoinsIcon,
  StethoscopeIcon,
  Users2Icon,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";

interface HubItem {
  href: string;
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}

const ITEMS: HubItem[] = [
  {
    href: "analytics/cohorts",
    titleKey: "cohorts.title",
    descriptionKey: "cohorts.description",
    icon: Users2Icon,
  },
  {
    href: "analytics/doctors",
    titleKey: "doctors.title",
    descriptionKey: "doctors.description",
    icon: StethoscopeIcon,
  },
  {
    href: "analytics/financial",
    titleKey: "financial.title",
    descriptionKey: "financial.description",
    icon: CoinsIcon,
  },
  {
    href: "analytics/schedule-heatmap",
    titleKey: "scheduleHeatmap.title",
    descriptionKey: "scheduleHeatmap.description",
    icon: CalendarRangeIcon,
  },
];

/**
 * Pro-dashboard hub. Renders four link cards above the legacy
 * analytics dashboard so an ADMIN can jump into any of the W2 surfaces in
 * one click. Locale-aware via the route's `[locale]` segment.
 */
export function AnalyticsHubCards() {
  const t = useTranslations("analyticsHub");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  return (
    <section className="flex flex-col gap-3 px-4 pt-4 sm:px-6 lg:px-8">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sectionTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("sectionHint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={`/${locale}/crm/${item.href}`}
              className="group focus:outline-none"
            >
              <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">
                      {t(item.titleKey)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t(item.descriptionKey)}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
