"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type NotificationsSubTab =
  | "activity"
  | "templates"
  | "campaigns"
  | "triggers";

const TABS: NotificationsSubTab[] = [
  "activity",
  "templates",
  "campaigns",
  "triggers",
];

const HREF_FOR: Record<NotificationsSubTab, string> = {
  activity: "/crm/notifications",
  templates: "/crm/notifications/templates",
  campaigns: "/crm/notifications/campaigns",
  triggers: "/crm/notifications/triggers",
};

export function NotificationsSubNav({
  active,
}: {
  active: NotificationsSubTab;
}) {
  const t = useTranslations("notifications.tabs");
  const locale = useLocale();

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="-mx-1 mt-2 flex gap-1 overflow-x-auto border-b border-border px-1 pb-[-1px]"
    >
      {TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={`/${locale}${HREF_FOR[tab]}`}
            className={cn(
              "relative shrink-0 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab)}
          </Link>
        );
      })}
    </nav>
  );
}
