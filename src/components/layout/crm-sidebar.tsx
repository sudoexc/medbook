"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import {
  BarChart3Icon,
  BellIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  FileTextIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  PhoneCallIcon,
  SendIcon,
  SettingsIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  { href: "reception", label: "Ресепшн", icon: LayoutDashboardIcon },
  { href: "appointments", label: "Записи", icon: ClipboardListIcon },
  { href: "calendar", label: "Календарь", icon: CalendarDaysIcon },
  { href: "patients", label: "Пациенты", icon: UsersIcon },
  { href: "doctors", label: "Врачи", icon: StethoscopeIcon },
  { href: "call-center", label: "Call Center", icon: PhoneCallIcon },
  { href: "telegram", label: "Telegram", icon: SendIcon },
  { href: "sms", label: "SMS", icon: MessageCircleIcon },
  { href: "documents", label: "Документы", icon: FileTextIcon },
  { href: "notifications", label: "Уведомления", icon: BellIcon },
  { href: "analytics", label: "Аналитика", icon: BarChart3Icon },
  { href: "settings", label: "Настройки", icon: SettingsIcon },
]

/**
 * Tiny SVG donut gauge for the sidebar footer. No chart library dependency.
 */
function DonutGauge({ percent, size = 56 }: { percent: number; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, percent))
  const dash = (pct / 100) * c
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={6}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

export interface CrmSidebarProps {
  /** Clinic name / brand label. */
  brand?: string
  /** Hard-coded load percentage for the footer donut (real value comes later). */
  loadPercent?: number
  /** Count of appointments today (real value comes later). */
  todayCount?: number
}

export function CrmSidebar({
  brand = "Neurofax",
  loadPercent = 63,
  todayCount = 128,
}: CrmSidebarProps) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const locale = typeof params?.locale === "string" ? params.locale : "ru"

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HeartPulseIcon className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-accent-foreground">{brand}</div>
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/70">
            медиа клиник
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const full = `/${locale}/crm/${item.href}`
            const active =
              pathname === full || pathname.startsWith(full + "/")
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={full}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/15 text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-primary" : "text-sidebar-foreground/70"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <Link
          href={`/${locale}/crm/analytics`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-primary hover:bg-sidebar-accent"
        >
          <DonutGauge percent={loadPercent} />
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-sidebar-foreground/70">
              Записей сегодня
            </div>
            <div className="truncate text-lg font-semibold text-sidebar-accent-foreground">
              {todayCount}
            </div>
            <div className="text-[11px] text-sidebar-foreground/60">
              {loadPercent}% загрузка
            </div>
          </div>
        </Link>
      </div>
    </aside>
  )
}
