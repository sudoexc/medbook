"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BadgeCheckIcon,
  BuildingIcon,
  CoinsIcon,
  DoorOpenIcon,
  HistoryIcon,
  PlugZapIcon,
  ScrollIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  key:
    | "clinic"
    | "users"
    | "services"
    | "cabinets"
    | "exchangeRates"
    | "roles"
    | "audit"
    | "integrations";
  href: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { key: "clinic", href: "clinic", icon: BuildingIcon },
  { key: "users", href: "users", icon: UsersIcon },
  { key: "services", href: "services", icon: StethoscopeIcon },
  { key: "cabinets", href: "cabinets", icon: DoorOpenIcon },
  { key: "exchangeRates", href: "exchange-rates", icon: CoinsIcon },
  { key: "roles", href: "roles", icon: BadgeCheckIcon },
  { key: "audit", href: "audit", icon: ScrollIcon },
  { key: "integrations", href: "integrations", icon: PlugZapIcon },
];

export function SettingsSidebar() {
  const t = useTranslations("settings");
  const pathname = usePathname() ?? "";
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <HistoryIcon className="size-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">{t("title")}</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const full = `/${locale}/crm/settings/${item.href}`;
            const active =
              pathname === full || pathname.startsWith(full + "/");
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={full}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate">{t(`nav.${item.key}`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
