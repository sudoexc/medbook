"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
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
import { useShellSummary } from "@/hooks/use-shell-summary"

type BadgeTone = "danger" | "info" | "warning" | "success"
/** Keys into ShellSummary.unread — drives the live badge count for each nav item. */
type BadgeKey = "calls" | "telegram" | "smsEmail" | "notifications"

type NavItem = {
  href: string
  /** key under crmShell.sidebarNav */
  labelKey: string
  icon: LucideIcon
  badgeKey?: BadgeKey
  badgeTone?: BadgeTone
}

type NavGroup = {
  /** key under crmShell.sidebarNav */
  labelKey?: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    items: [
      { href: "reception", labelKey: "reception", icon: LayoutDashboardIcon },
      { href: "appointments", labelKey: "appointments", icon: ClipboardListIcon },
      { href: "calendar", labelKey: "calendar", icon: CalendarDaysIcon },
      { href: "patients", labelKey: "patients", icon: UsersIcon },
      { href: "doctors", labelKey: "doctors", icon: StethoscopeIcon },
      { href: "rooms", labelKey: "rooms", icon: DoorOpenIcon },
      { href: "services", labelKey: "services", icon: SparklesIcon },
      { href: "documents", labelKey: "documents", icon: FileTextIcon },
    ],
  },
  {
    labelKey: "communications",
    items: [
      {
        href: "call-center",
        labelKey: "callCenter",
        icon: PhoneCallIcon,
        badgeKey: "calls",
        badgeTone: "danger",
      },
      {
        href: "telegram",
        labelKey: "telegram",
        icon: SendIcon,
        badgeKey: "telegram",
        badgeTone: "info",
      },
      {
        href: "sms",
        labelKey: "smsEmail",
        icon: MailIcon,
        badgeKey: "smsEmail",
        badgeTone: "warning",
      },
      {
        href: "notifications",
        labelKey: "notifications",
        icon: BellIcon,
        badgeKey: "notifications",
        badgeTone: "danger",
      },
    ],
  },
  {
    items: [
      { href: "analytics", labelKey: "analytics", icon: BarChart3Icon },
      { href: "settings", labelKey: "settings", icon: SettingsIcon },
    ],
  },
]

const BADGE_CLASS: Record<BadgeTone, string> = {
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
}

export function CrmSidebar({ brand = "Neurofax" }: CrmSidebarProps) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const locale = typeof params?.locale === "string" ? params.locale : "ru"
  const tNav = useTranslations("crmShell.sidebarNav")
  const tShell = useTranslations("crmShell")
  const { data: summary } = useShellSummary()
  const loadPercent = summary?.today.loadPercent ?? 0
  const todayCount = summary?.today.appointmentsCount ?? 0

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet text-white">
          <BrainIcon className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground">{brand}</div>
          <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {tShell("brand.tagline")}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-1">
        {NAV.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.labelKey ? (
              <div className="mb-1 px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {tNav(group.labelKey)}
              </div>
            ) : null}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const full = `/${locale}/crm/${item.href}`
                const active =
                  pathname === full || pathname.startsWith(full + "/")
                const Icon = item.icon
                const badgeCount =
                  item.badgeKey ? summary?.unread[item.badgeKey] ?? 0 : 0
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
                          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-success animate-in fade-in slide-in-from-left-1 duration-300"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          active ? "text-success" : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      <span className="flex-1 truncate">{tNav(item.labelKey)}</span>
                      {item.badgeTone && badgeCount > 0 ? (
                        <span
                          className={cn(
                            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                            BADGE_CLASS[item.badgeTone],
                          )}
                        >
                          {badgeCount}
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
              {tShell("footer.todayCount")}
            </div>
          </div>
        </Link>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ChevronsLeftIcon className="size-3.5" />
          {tShell("footer.collapse")}
        </button>
      </div>
    </aside>
  )
}
