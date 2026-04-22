"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BuildingIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  ScrollIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/admin/clinics", label: "Клиники", icon: BuildingIcon },
  { href: "/admin/users", label: "Пользователи", icon: UsersIcon },
  { href: "/admin/usage", label: "Использование", icon: GaugeIcon },
  { href: "/admin/audit", label: "Аудит", icon: ScrollIcon },
  { href: "/admin/health", label: "Здоровье", icon: ActivityIcon },
];

export function AdminSidebar() {
  const pathname = usePathname() ?? "";
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheckIcon className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-accent-foreground">
            MedBook Platform
          </div>
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/70">
            SUPER_ADMIN
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-active text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active
                        ? "text-primary"
                        : "text-sidebar-foreground/70",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <Link
          href="/ru/crm"
          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LayoutDashboardIcon className="size-4" />
          Вернуться в CRM
        </Link>
      </div>
    </aside>
  );
}
