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
  ChevronsRightIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  PhoneCallIcon,
  SendIcon,
  SettingsIcon,
  StethoscopeIcon,
  UsersIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useShellSummary } from "@/hooks/use-shell-summary"
import {
  ENTERPRISE_FLAGS,
  computeVisibleNav,
  type FeatureFlags,
} from "@/lib/feature-flags"

type BadgeTone = "danger" | "info" | "warning" | "success"
/** Keys into ShellSummary.unread — drives the live badge count for each nav item. */
type BadgeKey = "calls" | "telegram" | "notifications"

/**
 * `feature` is the gate consumed by `computeVisibleNav` (Phase 9d). When set,
 * the item only renders if the clinic's plan has that boolean flag = true.
 * Items without `feature` are unconditional (Basic-tier baseline).
 *
 * `requiredRole` (Phase 18 W2) hides the item unless the active session has
 * exactly that role. Currently used for ADMIN-only sub-navs (per-doctor
 * scoreboard, financial dashboard, …). Defense-in-depth — the page server
 * components also `notFound()` non-admins independently.
 *
 * `children` lets a parent item declare a static sub-menu. Visible only
 * when the parent route segment is active (or when `children` is non-empty
 * and the user is on a sibling of those children).
 */
type NavRole = "ADMIN"

type NavItem = {
  href: string
  /** key under crmShell.sidebarNav */
  labelKey: string
  icon: LucideIcon
  badgeKey?: BadgeKey
  badgeTone?: BadgeTone
  feature?: "hasTelegramInbox" | "hasCallCenter" | "hasAnalyticsPro"
  requiredRole?: NavRole
  children?: NavItem[]
}

type NavGroup = {
  /** key under crmShell.sidebarNav */
  labelKey?: string
  items: NavItem[]
}

/**
 * Phase 11 cleanup — `rooms`, `services`, `documents` are no longer surfaced
 * in the main CRM sidebar. They remain reachable via deeplinks from the
 * Settings overview (`/crm/settings`) and continue to live at their original
 * CRM paths (`/crm/rooms`, `/crm/services`, etc.) — only the menu entry is
 * removed, not the routes. (`/crm/sms` was removed entirely in SMS removal
 * Wave 2, see docs/TZ-sms-removal.md.)
 */
export const CRM_NAV: NavGroup[] = [
  {
    items: [
      { href: "reception", labelKey: "reception", icon: LayoutDashboardIcon },
      { href: "action-center", labelKey: "actionCenter", icon: ZapIcon },
      { href: "appointments", labelKey: "appointments", icon: ClipboardListIcon },
      { href: "calendar", labelKey: "calendar", icon: CalendarDaysIcon },
      { href: "patients", labelKey: "patients", icon: UsersIcon },
      { href: "doctors", labelKey: "doctors", icon: StethoscopeIcon },
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
        feature: "hasCallCenter",
      },
      {
        href: "telegram",
        labelKey: "telegram",
        icon: SendIcon,
        badgeKey: "telegram",
        badgeTone: "info",
        feature: "hasTelegramInbox",
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
      {
        href: "analytics",
        labelKey: "analytics",
        icon: BarChart3Icon,
        children: [
          // Phase 18 W2 — ADMIN-only pro dashboards. Plan-gated by
          // `hasAnalyticsPro` so the Basic-tier menu stays unchanged.
          {
            href: "analytics/cohorts",
            labelKey: "analyticsCohorts",
            icon: BarChart3Icon,
            requiredRole: "ADMIN",
            feature: "hasAnalyticsPro",
          },
          {
            href: "analytics/doctors",
            labelKey: "analyticsDoctors",
            icon: BarChart3Icon,
            requiredRole: "ADMIN",
            feature: "hasAnalyticsPro",
          },
          {
            href: "analytics/financial",
            labelKey: "analyticsFinancial",
            icon: BarChart3Icon,
            requiredRole: "ADMIN",
            feature: "hasAnalyticsPro",
          },
          {
            href: "analytics/schedule-heatmap",
            labelKey: "analyticsScheduleHeatmap",
            icon: BarChart3Icon,
            requiredRole: "ADMIN",
            feature: "hasAnalyticsPro",
          },
          // Phase 18 W3 — Custom Report Builder. Same gate as the W2
          // dashboards: ADMIN + hasAnalyticsPro plan flag.
          {
            href: "analytics/reports",
            labelKey: "analyticsReports",
            icon: BarChart3Icon,
            requiredRole: "ADMIN",
            feature: "hasAnalyticsPro",
          },
        ],
      },
      { href: "settings", labelKey: "settings", icon: SettingsIcon },
    ],
  },
]

/** Filter the static nav by the clinic's plan flags. Pure / DB-less. */
export function getVisibleCrmNav(
  flags: FeatureFlags,
  role: NavRole | null = null,
): NavGroup[] {
  const out = computeVisibleNav(CRM_NAV, flags) as NavGroup[]
  // Apply role-gating to items + children. `computeVisibleNav` only knows
  // about plan flags — role is a separate axis kept here so the pure helper
  // stays decoupled from session shape.
  return out
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => roleAllows(item.requiredRole, role))
        .map((item) =>
          item.children
            ? {
                ...item,
                children: item.children.filter((c) =>
                  roleAllows(c.requiredRole, role) &&
                  (!c.feature || flags[c.feature] === true),
                ),
              }
            : item,
        ),
    }))
    .filter((group) => group.items.length > 0)
}

function roleAllows(
  required: NavRole | undefined,
  current: NavRole | null,
): boolean {
  if (!required) return true
  return required === current
}

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
  /**
   * Effective feature flags for the current clinic. Drives plan-aware nav
   * filtering (Phase 9d). Defaults to ENTERPRISE_FLAGS so the component still
   * renders sensibly when used outside a server-rendered layout (Storybook,
   * a test harness without a session). Production callers — i.e. the CRM
   * layout — pass the resolved flags from `getFeatureFlagsForCurrentSession`.
   */
  flags?: FeatureFlags
  /**
   * Active session role. Drives role-gated nav children — e.g. the W2 pro
   * dashboards under /crm/analytics/* are ADMIN-only. Pass `null` for
   * unauthenticated / Storybook contexts; the gate stays closed.
   */
  role?: NavRole | null
}

const COLLAPSED_STORAGE_KEY = "crm:sidebar:collapsed"

export function CrmSidebar({
  brand = "Neurofax",
  flags = ENTERPRISE_FLAGS,
  role = null,
}: CrmSidebarProps) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const locale = typeof params?.locale === "string" ? params.locale : "ru"
  const tNav = useTranslations("crmShell.sidebarNav")
  const tShell = useTranslations("crmShell")
  const { data: summary } = useShellSummary()
  const loadPercent = summary?.today.loadPercent ?? 0
  const todayCount = summary?.today.appointmentsCount ?? 0
  const visibleNav = React.useMemo(
    () => getVisibleCrmNav(flags, role),
    [flags, role],
  )

  // Persist collapsed state in localStorage so a hard reload keeps the user's
  // chosen sidebar width. We hydrate after mount to avoid SSR/CSR mismatch on
  // the initial paint — the server always renders expanded.
  const [collapsed, setCollapsed] = React.useState(false)
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
      if (raw === "1") setCollapsed(true)
    } catch {
      /* localStorage disabled — fall back to expanded */
    }
  }, [])
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0")
      } catch {
        /* ignore — state still toggles in memory */
      }
      return next
    })
  }, [])

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[240px]",
      )}
    >
      <Link
        href={`/${locale}/crm/reception`}
        aria-label={tShell("brand.homeLink")}
        title={collapsed ? brand : undefined}
        className={cn(
          "motion-press flex h-16 items-center gap-2.5 outline-none transition-colors hover:bg-sidebar-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet text-white">
          <BrainIcon className="size-5" />
        </div>
        {collapsed ? null : (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">{brand}</div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {tShell("brand.tagline")}
            </div>
          </div>
        )}
      </Link>
      <nav className={cn("flex-1 overflow-y-auto py-1", collapsed ? "px-2" : "px-3")}>
        {visibleNav.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.labelKey && !collapsed ? (
              <div className="mb-1 px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {tNav(group.labelKey)}
              </div>
            ) : null}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const full = `/${locale}/crm/${item.href}`
                // next-intl runs with `localePrefix: "as-needed"`, so URLs for
                // the default locale (ru) have no `/ru` prefix — usePathname
                // returns `/crm/...`. Compare against both shapes so the
                // active highlight works for ru and uz uniformly.
                const bare = `/crm/${item.href}`
                const active =
                  pathname === full ||
                  pathname.startsWith(full + "/") ||
                  pathname === bare ||
                  pathname.startsWith(bare + "/")
                const Icon = item.icon
                const badgeCount =
                  item.badgeKey ? summary?.unread[item.badgeKey] ?? 0 : 0
                const visibleChildren = item.children?.filter((c) => {
                  // Children are pre-filtered by getVisibleCrmNav; this is
                  // a defense-in-depth no-op when called via the prod path.
                  return true
                }) ?? []
                const label = tNav(item.labelKey)
                return (
                  <li key={item.href}>
                    <Link
                      href={full}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "motion-press group relative flex items-center rounded-lg text-sm transition-colors",
                        collapsed
                          ? "justify-center px-2 py-2"
                          : "gap-3 px-3 py-2",
                        active
                          ? "bg-primary/10 font-semibold text-primary"
                          : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-primary animate-in fade-in slide-in-from-left-1 duration-300"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      {collapsed ? (
                        // Tiny badge dot — count is invisible to keep the rail
                        // narrow, but the dot still signals "you have unread".
                        item.badgeTone && badgeCount > 0 ? (
                          <span
                            aria-label={`${label}: ${badgeCount}`}
                            className={cn(
                              "absolute right-1 top-1 size-1.5 rounded-full",
                              BADGE_CLASS[item.badgeTone],
                            )}
                          />
                        ) : null
                      ) : (
                        <>
                          <span className="flex-1 truncate">{label}</span>
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
                        </>
                      )}
                    </Link>
                    {/*
                      Sub-nav: only render once the parent route is active so
                      the sidebar doesn't grow taller until the user actually
                      navigates into the section.
                    */}
                    {!collapsed && active && visibleChildren.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 pl-7">
                        {visibleChildren.map((child) => {
                          const childFull = `/${locale}/crm/${child.href}`
                          const childBare = `/crm/${child.href}`
                          const childActive =
                            pathname === childFull ||
                            pathname.startsWith(childFull + "/") ||
                            pathname === childBare ||
                            pathname.startsWith(childBare + "/")
                          return (
                            <li key={child.href}>
                              <Link
                                href={childFull}
                                aria-current={childActive ? "page" : undefined}
                                className={cn(
                                  "block rounded-md px-2 py-1 text-xs transition-colors",
                                  childActive
                                    ? "bg-primary/10 font-semibold text-primary"
                                    : "font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                )}
                              >
                                {tNav(child.labelKey)}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div
        className={cn(
          "border-t border-sidebar-border py-4",
          collapsed ? "px-2" : "px-4",
        )}
      >
        <Link
          href={`/${locale}/crm/analytics`}
          title={collapsed ? `${todayCount} ${tShell("footer.todayCount")}` : undefined}
          className={cn(
            "motion-press flex items-center rounded-xl p-2 transition-colors hover:bg-sidebar-accent",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <DonutGauge percent={loadPercent} size={collapsed ? 40 : 64} />
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-bold text-foreground tabular-nums">
                {todayCount}
              </div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {tShell("footer.todayCount")}
              </div>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? tShell("footer.expand") : tShell("footer.collapse")}
          title={collapsed ? tShell("footer.expand") : tShell("footer.collapse")}
          className={cn(
            "motion-press mt-2 flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
            !collapsed && "gap-1.5",
          )}
        >
          {collapsed ? (
            <ChevronsRightIcon className="size-3.5" />
          ) : (
            <>
              <ChevronsLeftIcon className="size-3.5" />
              {tShell("footer.collapse")}
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
