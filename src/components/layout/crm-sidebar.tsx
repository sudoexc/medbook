"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import {
  BarChart3Icon,
  BellIcon,
  BrainIcon,
  CalendarDaysIcon,
  ChevronsLeftIcon,
  ClipboardListIcon,
  DoorOpenIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MailIcon,
  PhoneCallIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  badge?: { count: number; tone: "danger" | "info" | "warning" | "success" }
}

type NavGroup = {
  label?: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    items: [
      { href: "reception", label: "Ресепшн", icon: LayoutDashboardIcon },
      { href: "appointments", label: "Записи", icon: ClipboardListIcon },
      { href: "calendar", label: "Расписание", icon: CalendarDaysIcon },
      { href: "patients", label: "Пациенты", icon: UsersIcon },
      { href: "doctors", label: "Врачи", icon: StethoscopeIcon },
      { href: "rooms", label: "Кабинеты", icon: DoorOpenIcon },
      { href: "services", label: "Услуги", icon: SparklesIcon },
      { href: "documents", label: "Документы", icon: FileTextIcon },
    ],
  },
  {
    label: "Коммуникации",
    items: [
      {
        href: "call-center",
        label: "Call Center",
        icon: PhoneCallIcon,
        badge: { count: 3, tone: "danger" },
      },
      {
        href: "telegram",
        label: "Telegram",
        icon: SendIcon,
        badge: { count: 8, tone: "info" },
      },
      {
        href: "sms",
        label: "SMS-Email",
        icon: MailIcon,
        badge: { count: 2, tone: "warning" },
      },
      {
        href: "notifications",
        label: "Уведомления",
        icon: BellIcon,
        badge: { count: 5, tone: "danger" },
      },
    ],
  },
  {
    items: [
      { href: "analytics", label: "Аналитика", icon: BarChart3Icon },
      { href: "settings", label: "Настройки", icon: SettingsIcon },
    ],
  },
]

const BADGE_CLASS: Record<NonNullable<NavItem["badge"]>["tone"], string> = {
  danger: "bg-destructive text-destructive-foreground",
  info: "bg-info text-info-foreground",
  warning: "bg-warning text-warning-foreground",
  success: "bg-success text-success-foreground",
}

/**
 * Tiny SVG donut gauge for the sidebar footer. No chart library dependency.
 */
function DonutGauge({
  percent,
  size = 64,
}: {
  percent: number
  size?: number
}) {
  const stroke = 7
  const r = (size - stroke) / 2
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
        stroke="var(--muted)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--success)"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.28}
        fontWeight={700}
        fill="var(--success)"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  )
}

export interface CrmSidebarProps {
  brand?: string
  loadPercent?: number
  todayCount?: number
}

export function CrmSidebar({
  brand = "Neurofax",
  loadPercent = 83,
  todayCount = 128,
}: CrmSidebarProps) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const locale = typeof params?.locale === "string" ? params.locale : "ru"

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet text-white">
          <BrainIcon className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground">{brand}</div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            умная клиника
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-1">
        {NAV.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.label ? (
              <div className="mb-1 px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {group.label}
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
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
                          ? "bg-sidebar-active text-sidebar-active-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-success"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-success" : "text-muted-foreground",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className={cn(
                            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                            BADGE_CLASS[item.badge.tone],
                          )}
                        >
                          {item.badge.count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-4 py-4">
        <Link
          href={`/${locale}/crm/analytics`}
          className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-sidebar-accent"
        >
          <DonutGauge percent={loadPercent} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold text-foreground tabular-nums">
              {todayCount}
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Записей сегодня
            </div>
          </div>
        </Link>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ChevronsLeftIcon className="size-3.5" />
          Свернуть
        </button>
      </div>
    </aside>
  )
}
