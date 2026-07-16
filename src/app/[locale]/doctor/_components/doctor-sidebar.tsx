"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3Icon,
  BookOpenIcon,
  BrainIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  SendIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useDoctorSidebarStats } from "../_hooks/use-doctor-sidebar-stats";

type NavItem = {
  href: string;
  // Translation key suffix under `sidebar.*`; resolved at render via `t`.
  labelKey: string;
  icon: LucideIcon;
  badge?: number;
};

type NavGroup = {
  // Translation key suffix under `groups.*`; resolved at render via `t`.
  labelKey?: string;
  items: NavItem[];
};

const DOCTOR_NAV: NavGroup[] = [
  {
    labelKey: "groups.workspace",
    items: [
      { href: "my-day", labelKey: "sidebar.myDay", icon: SunIcon },
      { href: "reception", labelKey: "sidebar.reception", icon: ClipboardCheckIcon },
      { href: "patients", labelKey: "sidebar.patients", icon: UsersIcon },
      // «История визитов» hidden from the cabinet nav per doctor feedback —
      // every patient card already carries its own visit history. The
      // /doctor/visits route stays intact (per-patient deep links use it).
      // «Документы» likewise hidden — route + per-patient documents stay.
      { href: "conclusions", labelKey: "sidebar.conclusions", icon: FileTextIcon },
      // «Сообщения» → «Telegram» — the doctor↔patient chat reaches patients
      // through the Telegram mini-app; the label + icon make that explicit.
      { href: "messages", labelKey: "sidebar.telegram", icon: SendIcon },
      { href: "analytics", labelKey: "sidebar.analytics", icon: BarChart3Icon },
    ],
  },
  // «Уведомления» hidden per doctor feedback — the «Мой день» today-tasks
  // surface those items instead. Route stays for deep links. That left the
  // «Коммуникации» group empty, so it's dropped.
  {
    labelKey: "groups.settings",
    items: [
      { href: "references", labelKey: "sidebar.references", icon: BookOpenIcon },
      { href: "settings", labelKey: "sidebar.settings", icon: SettingsIcon },
    ],
  },
];

function DonutGauge({
  percent,
  size = 56,
}: {
  percent: number;
  size?: number;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const dash = (pct / 100) * c;
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
        fontSize={size * 0.26}
        fontWeight={700}
        fill="var(--success)"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

const COLLAPSED_STORAGE_KEY = "doctor:sidebar:collapsed";

export function DoctorSidebar() {
  const t = useTranslations("doctor.nav");
  const pathname = usePathname() ?? "";
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      /* localStorage disabled */
    }
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Live numbers from /api/crm/doctors/me/sidebar-stats. The hook also
  // wires SSE invalidation, so a status change in the reception flow
  // (or a fresh Telegram message) propagates into the sidebar inside
  // the 400ms debounce window without us having to refetch on focus.
  const { data: stats } = useDoctorSidebarStats();
  const loadPercent = stats?.loadPercent ?? 0;
  const todayCount = stats?.todayCount ?? 0;
  const badgeByHref: Record<string, number> = {
    "my-day": stats?.todayBadge ?? 0,
    messages: stats?.unreadMessages ?? 0,
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[240px]",
      )}
    >
      <Link
        href={`/${locale}/doctor/my-day`}
        aria-label={t("brand.homeAria")}
        title={collapsed ? "Neurofax" : undefined}
        className={cn(
          "motion-press flex h-16 shrink-0 items-center gap-2.5 outline-none transition-colors hover:bg-sidebar-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet text-white">
          <BrainIcon className="size-5" />
        </div>
        {collapsed ? null : (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">Neurofax</div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("brand.tagline")}
            </div>
          </div>
        )}
      </Link>

      <nav
        className={cn(
          "flex-1 overflow-y-auto py-1",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {DOCTOR_NAV.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.labelKey && !collapsed ? (
              <div className="mb-1 px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {t(group.labelKey)}
              </div>
            ) : null}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const full = `/${locale}/doctor/${item.href}`;
                const bare = `/doctor/${item.href}`;
                const active =
                  pathname === full ||
                  pathname.startsWith(full + "/") ||
                  pathname === bare ||
                  pathname.startsWith(bare + "/");
                const Icon = item.icon;
                const label = t(item.labelKey);
                // `badgeByHref` lookup wins over the static `item.badge`
                // so the sidebar nav stays a pure constant (easy to grep)
                // while the live numbers come from the hook.
                const badge =
                  badgeByHref[item.href] ?? item.badge ?? 0;
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
                          className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          active
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      {collapsed ? (
                        badge > 0 ? (
                          <span
                            aria-label={`${label}: ${badge}`}
                            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                          />
                        ) : null
                      ) : (
                        <>
                          <span className="flex-1 truncate">{label}</span>
                          {badge > 0 ? (
                            <span
                              className={cn(
                                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-primary/10 text-primary",
                              )}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-sidebar-border py-4",
          collapsed ? "px-2" : "px-4",
        )}
      >
        <div
          className={cn(
            "flex items-center rounded-xl p-2",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <DonutGauge percent={loadPercent} size={collapsed ? 40 : 56} />
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-bold text-foreground tabular-nums">
                {todayCount}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground">
                {t("footer.todayRecords")}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? t("collapse.expand") : t("collapse.collapse")}
          title={collapsed ? t("collapse.expand") : t("collapse.collapse")}
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
              {t("collapse.collapse")}
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
