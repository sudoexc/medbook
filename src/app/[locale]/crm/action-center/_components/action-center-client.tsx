"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CalendarCheck2Icon,
  CalendarClockIcon,
  ChevronDownIcon,
  ClockIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  RefreshCcwIcon,
  RefreshCwIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  TrendingDownIcon,
  UsersIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AI_ENABLED } from "@/lib/ai-enabled";
import { InDevelopment } from "@/components/ui/in-development";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/atoms/money-text";
import { CountUp } from "@/components/atoms/count-up";
import { AnimatedMoney } from "@/components/motion/animated-money";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { formatActionTitle, formatActionBody } from "@/lib/actions/format";
import {
  ACTIONABLE_STATUSES,
  actionRowDeeplinkPath,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actions/types";
import { formatClinicDateTime, type Locale } from "@/lib/format";
import { addTashkentDays, tashkentToday } from "@/lib/tashkent-time";

import {
  useActionsPaged,
  useActionsSummary,
  useDoneAction,
  useDismissAction,
  useRecomputeActions,
  useSnoozeAction,
  useDoctorsLoad,
  type ActionRow,
  type ActionsSummary,
} from "../_hooks/use-actions";
import { RiskTodaySection } from "./risk-today-section";
import { useReceptionDashboard } from "../../reception/_hooks/use-reception-live";

type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR"
  | null;

// Money on this page comes only from the clinic's own data (audit AC-15):
// the average price of its completed visits over 90 days
// (`DashboardResponse.avgVisitTiins`), the detectors' estimates and the
// debts themselves. There used to be an invented 80 000 сум average for a
// clinic without history, a «60% of the visit is lost on a no-show» factor
// and «40% / 22.5% of a missed request / call converts» rates: numbers with
// no source, shown to the owner as losses. Where the data is missing the
// page says «нет данных».

export interface ActionCenterClientProps {
  role: Role;
  /** The clinic's plan has the Call Center (`/crm/call-center` 404s otherwise). */
  hasCallCenter: boolean;
  /** The clinic's plan has the Telegram inbox. */
  hasTelegramInbox: boolean;
  /** This viewer can open a Telegram broadcast: admin, inbox, bot connected. */
  canBroadcast: boolean;
}

export function ActionCenterClient({
  role,
  hasCallCenter,
  hasTelegramInbox,
  canBroadcast,
}: ActionCenterClientProps) {
  const t = useTranslations("actionCenter");
  const td = useTranslations("actionCenter.dashboard");
  const locale = useLocale() as Locale;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  // OPEN + SNOOZED: the list endpoint hides a snoozed row until its timer
  // elapses, then serves it again. Asking for OPEN alone made «Отложить» a
  // silent delete (audit AC-01). Paged with «Показать ещё» (audit AC-18).
  const {
    rows: actions,
    isLoading,
    hasMore,
    loadMore,
    isLoadingMore,
  } = useActionsPaged({
    status: ACTIONABLE_STATUSES,
    limit: 50,
  });
  // Every count and sum on the page comes from the server aggregate over all
  // open tasks, not from the pages loaded so far (audit AC-18).
  const { data: summary } = useActionsSummary();
  const { data: dashboard } = useReceptionDashboard();

  const recompute = useRecomputeActions();

  const localePath = React.useCallback(
    (path: string) => (path.startsWith("/") ? `/${locale}${path}` : path),
    [locale],
  );

  const fireRecompute = async () => {
    try {
      const r = await recompute.mutateAsync();
      toast.success(
        t("recomputeSuccess", { created: r.created, updated: r.updated }),
      );
    } catch (e) {
      toast.error(
        t("recomputeError", {
          reason: e instanceof Error ? e.message : "Error",
        }),
      );
    }
  };

  // Null until the clinic has priced completed visits: then no money figure
  // that needs an average is shown.
  const avgVisitTiins =
    dashboard?.avgVisitTiins && dashboard.avgVisitTiins > 0
      ? dashboard.avgVisitTiins
      : null;

  const buckets = React.useMemo(
    () => kpisFromSummary(summary, avgVisitTiins),
    [summary, avgVisitTiins],
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            {td("headerTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {td("headerSubtitle")}
          </p>
        </div>
        {isAdmin ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void fireRecompute()}
            disabled={recompute.isPending}
          >
            <RefreshCcwIcon
              className={cn(
                "size-3.5",
                recompute.isPending && "animate-spin",
              )}
            />
            {t("recomputeNow")}
          </Button>
        ) : null}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <RiskTodaySection anchorId="risk-today" />
          <KpiStrip buckets={buckets} hasCallCenter={hasCallCenter} />
          <ActionsList
            actions={actions}
            summary={summary}
            isLoading={isLoading}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            localePath={localePath}
            avgVisitTiins={avgVisitTiins}
          />
          {/* «Очередь задач на сегодня» removed per feedback — it rendered
              synthetic hour slots + raw action types (PATIENT_NO_CHANNEL).
              The real work lives in the risk-today widget + the actions list. */}
          <DoctorsLoad />
        </div>
        <aside className="flex flex-col gap-5">
          <AiRecs
            buckets={buckets}
            hasCallCenter={hasCallCenter}
            hasTelegramInbox={hasTelegramInbox}
            canReactivate={isAdmin}
          />
          <QuickActionsGrid
            hasCallCenter={hasCallCenter}
            canBroadcast={canBroadcast}
            canReactivate={isAdmin}
          />
          <TodayLosses
            buckets={buckets}
            missedToday={dashboard?.missedToday}
            hasCallCenter={hasCallCenter}
          />
        </aside>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI math + AI recs, from the server aggregate.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Counts and money for the tiles, «Потери сегодня» and the AI hints. Built
 * from `GET /api/crm/actions/summary`, which covers every open task: the old
 * version bucketed the loaded page, so past 50 open tasks every tile
 * undercounted (audit AC-18). Zeros until the summary arrives.
 */
type Buckets = {
  unconfirmed: number;
  freeSlots: number;
  noShowRisk: number;
  payments: number;
  dormantPatients: number;
  /** What the unconfirmed visits are worth; null without an average price. */
  unconfirmedRevTiins: number | null;
  freeSlotsRevTiins: number;
  /**
   * Expected loss on the flagged visits: Σ no-show probability × the average
   * visit price. Null without an average price.
   */
  noShowLossTiins: number | null;
  paymentsLossTiins: number;
};

function kpisFromSummary(
  summary: ActionsSummary | undefined,
  avgVisitTiins: number | null,
): Buckets {
  const count = (type: ActionType) => summary?.byType[type] ?? 0;
  const unconfirmed = count("UNCONFIRMED_24H");
  return {
    unconfirmed,
    freeSlots: count("EMPTY_SLOT_TOMORROW"),
    noShowRisk: count("NO_SHOW_RISK_HIGH"),
    payments: count("PAYMENT_OVERDUE"),
    dormantPatients: summary?.dormantPatients ?? 0,
    unconfirmedRevTiins: avgVisitTiins === null ? null : unconfirmed * avgVisitTiins,
    freeSlotsRevTiins: summary?.freeSlotsRevenueTiins ?? 0,
    noShowLossTiins:
      avgVisitTiins === null
        ? null
        : Math.round(avgVisitTiins * (summary?.noShowRiskSum ?? 0)),
    paymentsLossTiins: summary?.paymentsAmountTiins ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// KPI strip — 4 tiles
// ────────────────────────────────────────────────────────────────────────────

/** A loss is shown as a negative amount; null (no data) stays null. */
function asLoss(tiins: number | null): number | null {
  return tiins === null ? null : -tiins;
}

function KpiStrip({
  buckets,
  hasCallCenter,
}: {
  buckets: Buckets;
  hasCallCenter: boolean;
}) {
  const td = useTranslations("actionCenter.dashboard.kpi");
  const locale = useLocale();

  // Every tile opens the place where its tasks are worked (audit AC-14):
  // the Call Center's «К подтверждению» when the plan has it (the appointments
  // list's unconfirmed bucket otherwise), tomorrow in the calendar, and the
  // risk list on this page. «Риск пропуска» used to open the visits already
  // marked no-show.
  const tiles = [
    {
      key: "unconfirmed",
      label: td("unconfirmed"),
      count: buckets.unconfirmed,
      unit: td("unconfirmedUnit"),
      // At stake, so a loss: it used to read as a green «+» gain.
      moneyTiins: asLoss(buckets.unconfirmedRevTiins),
      hint: td("potentialLoss"),
      tone: "warning" as const,
      icon: <UsersIcon className="size-5" />,
      href: hasCallCenter
        ? `/${locale}/crm/call-center`
        : `/${locale}/crm/appointments?bucket=unconfirmed`,
    },
    {
      key: "freeSlots",
      label: td("freeSlots"),
      count: buckets.freeSlots,
      unit: td("freeSlotsUnit"),
      moneyTiins: buckets.freeSlotsRevTiins,
      hint: td("potentialRevenue"),
      tone: "success" as const,
      icon: <CalendarClockIcon className="size-5" />,
      href: `/${locale}/crm/calendar?date=${addTashkentDays(tashkentToday(), 1)}`,
    },
    {
      key: "noShow",
      label: td("noShowRisk"),
      count: buckets.noShowRisk,
      unit: td("noShowRiskUnit"),
      moneyTiins: asLoss(buckets.noShowLossTiins),
      hint: td("potentialLoss"),
      tone: "pink" as const,
      icon: <TrendingDownIcon className="size-5" />,
      href: "#risk-today",
    },
  ];

  return (
    <div className="motion-stagger grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map(({ key, ...tile }) => (
        <KpiCard key={key} {...tile} />
      ))}
    </div>
  );
}

const TONE_CHIP: Record<
  "primary" | "info" | "warning" | "success" | "danger" | "violet" | "pink",
  string
> = {
  primary: "bg-primary/15 text-primary",
  info: "bg-info/15 text-[color:var(--info)]",
  warning: "bg-warning/20 text-[color:var(--warning-foreground)]",
  success: "bg-success/15 text-[color:var(--success)]",
  danger: "bg-destructive/15 text-destructive",
  violet: "bg-violet/15 text-[color:var(--violet)]",
  pink: "bg-pink/15 text-[color:var(--pink)]",
};

function KpiCard({
  label,
  count,
  unit,
  moneyTiins,
  hint,
  tone,
  icon,
  href,
}: {
  label: string;
  count: number;
  unit: string;
  /** Null: the clinic has no data to price it with. */
  moneyTiins: number | null;
  hint: string;
  tone: keyof typeof TONE_CHIP;
  icon: React.ReactNode;
  href: string;
}) {
  const t = useTranslations("actionCenter.dashboard.kpi");
  const isLoss = moneyTiins !== null && moneyTiins < 0;
  return (
    <Link
      href={href}
      className="motion-rise-in motion-press motion-hover-lift block rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/30"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl",
            TONE_CHIP[tone],
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              <CountUp to={count} />
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {unit}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-2">
        {moneyTiins === null ? (
          <div className="text-base font-semibold text-muted-foreground">
            {t("noData")}
          </div>
        ) : (
          <div
            className={cn(
              "text-base font-bold tabular-nums",
              isLoss
                ? "text-destructive"
                : moneyTiins > 0
                  ? "text-success"
                  : "text-foreground",
            )}
          >
            {moneyTiins > 0 ? "+" : ""}
            <AnimatedMoney amount={moneyTiins} currency="UZS" />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Actions list — top priority items
// ────────────────────────────────────────────────────────────────────────────

const ACTION_CTA: Record<
  ActionType,
  {
    cta: keyof IntlMessages["actionCenter"]["dashboard"]["actionsList"];
    tone: keyof typeof TONE_CHIP;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  EMPTY_SLOT_TOMORROW: {
    cta: "ctaFillSlots",
    tone: "success",
    Icon: CalendarClockIcon,
  },
  UNCONFIRMED_24H: { cta: "ctaCall", tone: "primary", Icon: PhoneIcon },
  NO_SHOW_RISK_HIGH: { cta: "ctaCall", tone: "danger", Icon: AlertTriangleIcon },
  DORMANT_BATCH: { cta: "ctaReactivation", tone: "violet", Icon: UsersIcon },
  CASE_REPEAT_DUE: { cta: "ctaOpen", tone: "info", Icon: RefreshCwIcon },
  OVERDUE_FOLLOW_UP: { cta: "ctaCallback", tone: "violet", Icon: PhoneIcon },
  DOCTOR_OVERLOAD: { cta: "ctaTransfer", tone: "warning", Icon: UsersIcon },
  IDLE_ROOM: { cta: "ctaTransfer", tone: "info", Icon: SettingsIcon },
  PAYMENT_OVERDUE: { cta: "ctaCallback", tone: "warning", Icon: BanknoteIcon },
  LOW_DOCTOR_SCHEDULE: { cta: "ctaOpen", tone: "info", Icon: CalendarCheck2Icon },
  LOW_NPS_RECEIVED: { cta: "ctaCallback", tone: "pink", Icon: PhoneIcon },
  PATIENT_NO_CHANNEL: { cta: "ctaCall", tone: "warning", Icon: PhoneIcon },
  VISIT_FOLLOW_UP_DUE: { cta: "ctaCall", tone: "info", Icon: CalendarCheck2Icon },
  TELEGRAM_LINK_CONFLICT: { cta: "ctaOpen", tone: "warning", Icon: UsersIcon },
  NO_CONTACT_CALL: { cta: "ctaCall", tone: "violet", Icon: PhoneIcon },
  PATIENT_CALLBACK: { cta: "ctaCallback", tone: "primary", Icon: PhoneIcon },
};

// Type helper so TypeScript knows the keys are valid i18n paths.
type IntlMessages = {
  actionCenter: {
    dashboard: {
      actionsList: Record<string, string>;
    };
  };
};

const SEVERITY_PILL: Record<ActionSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-warning/20 text-[color:var(--warning-foreground)]",
  medium: "bg-info/15 text-[color:var(--info)]",
  low: "bg-muted text-muted-foreground",
};

// Category model — five operational buckets that mirror how a receptionist's
// day actually splits up: phone work → schedule work → money → strategic
// reactivation → background ops. Ordering reflects "what to do first".
type CategoryKey =
  | "calls"
  | "slots"
  | "payments"
  | "reactivation"
  | "operations";

const CATEGORY_MAP: Record<ActionType, CategoryKey> = {
  UNCONFIRMED_24H: "calls",
  NO_SHOW_RISK_HIGH: "calls",
  OVERDUE_FOLLOW_UP: "calls",
  LOW_NPS_RECEIVED: "calls",
  PATIENT_NO_CHANNEL: "calls",
  VISIT_FOLLOW_UP_DUE: "calls",
  NO_CONTACT_CALL: "calls",
  PATIENT_CALLBACK: "calls",
  EMPTY_SLOT_TOMORROW: "slots",
  IDLE_ROOM: "slots",
  LOW_DOCTOR_SCHEDULE: "slots",
  PAYMENT_OVERDUE: "payments",
  DORMANT_BATCH: "reactivation",
  CASE_REPEAT_DUE: "reactivation",
  DOCTOR_OVERLOAD: "operations",
  TELEGRAM_LINK_CONFLICT: "operations",
};

const CATEGORY_ORDER: readonly CategoryKey[] = [
  "calls",
  "slots",
  "payments",
  "reactivation",
  "operations",
];

const CATEGORY_META: Record<
  CategoryKey,
  {
    Icon: React.ComponentType<{ className?: string }>;
    tone: keyof typeof TONE_CHIP;
  }
> = {
  calls: { Icon: PhoneIcon, tone: "primary" },
  slots: { Icon: CalendarClockIcon, tone: "success" },
  payments: { Icon: BanknoteIcon, tone: "warning" },
  reactivation: { Icon: UsersIcon, tone: "violet" },
  operations: { Icon: SettingsIcon, tone: "info" },
};

function groupByCategory(rows: ActionRow[]): Map<CategoryKey, ActionRow[]> {
  const map = new Map<CategoryKey, ActionRow[]>();
  for (const row of rows) {
    const cat = CATEGORY_MAP[row.type];
    if (!cat) continue;
    const list = map.get(cat) ?? [];
    list.push(row);
    map.set(cat, list);
  }
  return map;
}

const SECTION_PREVIEW_LIMIT = 5;

function ActionsList({
  actions,
  summary,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  localePath,
  avgVisitTiins,
}: {
  actions: ActionRow[];
  summary: ActionsSummary | undefined;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  localePath: (path: string) => string;
  avgVisitTiins: number | null;
}) {
  const td = useTranslations("actionCenter.dashboard.actionsList");
  const tac = useTranslations("actionCenter");

  const grouped = React.useMemo(() => groupByCategory(actions), [actions]);
  // Counters show every open task (server aggregate), the sections the rows
  // loaded so far; «Показать ещё» brings the next page in.
  const total = summary?.total ?? actions.length;
  const categoryTotals = React.useMemo(
    () => categoryTotalsOf(summary),
    [summary],
  );
  const remaining = Math.max(0, total - actions.length);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">{td("title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {td("subtitle")}
          </p>
        </div>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary tabular-nums">
          {total}
        </span>
      </header>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-muted-foreground">
          {td("empty")}
        </p>
      ) : (
        <div className="motion-stagger mt-4 space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const rows = grouped.get(cat);
            if (!rows || rows.length === 0) return null;
            return (
              <CategorySection
                key={cat}
                category={cat}
                rows={rows}
                total={Math.max(rows.length, categoryTotals.get(cat) ?? 0)}
                localePath={localePath}
                avgVisitTiins={avgVisitTiins}
              />
            );
          })}
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="gap-1.5"
              >
                {isLoadingMore ? (
                  <RefreshCcwIcon className="size-3.5 animate-spin" />
                ) : (
                  <ChevronDownIcon className="size-3.5" />
                )}
                {remaining > 0
                  ? td("loadMoreRemaining", { count: remaining })
                  : tac("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Open tasks per category from the server aggregate (all pages). */
function categoryTotalsOf(
  summary: ActionsSummary | undefined,
): Map<CategoryKey, number> {
  const totals = new Map<CategoryKey, number>();
  if (!summary) return totals;
  for (const [type, n] of Object.entries(summary.byType)) {
    const cat = CATEGORY_MAP[type as ActionType];
    if (!cat || !n) continue;
    totals.set(cat, (totals.get(cat) ?? 0) + n);
  }
  return totals;
}

function CategorySection({
  category,
  rows,
  total,
  localePath,
  avgVisitTiins,
}: {
  category: CategoryKey;
  /** The rows of this category loaded so far. */
  rows: ActionRow[];
  /** Every open task of this category, loaded or not. */
  total: number;
  localePath: (path: string) => string;
  avgVisitTiins: number | null;
}) {
  const td = useTranslations("actionCenter.dashboard.actionsList");
  const meta = CATEGORY_META[category];
  const Icon = meta.Icon;

  const [expanded, setExpanded] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  // Sum of per-row revenue/loss estimates → group-level money chip.
  // Payments are tracked as positive amounts owed; everything else is a
  // potential gain if recovered, so we sum positives only.
  const groupImpactTiins = React.useMemo(() => {
    let total = 0;
    for (const r of rows) {
      const v = pricePerAction(r, avgVisitTiins);
      if (typeof v === "number" && v > 0) total += v;
    }
    return total;
  }, [rows, avgVisitTiins]);

  const visible = expanded ? rows : rows.slice(0, SECTION_PREVIEW_LIMIT);
  const canExpand = rows.length > SECTION_PREVIEW_LIMIT;

  return (
    <div className="motion-rise-in overflow-hidden rounded-xl border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        aria-expanded={!collapsed}
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TONE_CHIP[meta.tone],
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            {td(`categories.${category}.title`)}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {td(`categories.${category}.subtitle`)}
          </p>
        </div>
        <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-foreground">
          {total}
        </span>
        {groupImpactTiins > 0 ? (
          <span className="hidden shrink-0 text-right md:block">
            <span className="text-sm font-bold tabular-nums text-success">
              +<MoneyText amount={groupImpactTiins} currency="UZS" />
            </span>
          </span>
        ) : null}
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            collapsed ? "-rotate-90" : "",
          )}
        />
      </button>

      {!collapsed ? (
        <div className="border-t border-border p-3">
          <div className="space-y-2">
            {visible.map((row) => (
              <ActionRowCard
                key={row.id}
                row={row}
                localePath={localePath}
                avgVisitTiins={avgVisitTiins}
              />
            ))}
          </div>
          {canExpand ? (
            <div className="mt-3 flex justify-center border-t border-border pt-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="motion-press inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {expanded
                  ? td("collapseList")
                  : td("showAllTasks", { count: rows.length })}
                <ArrowRightIcon
                  className={cn(
                    "size-3 transition-transform",
                    expanded ? "-rotate-90" : "rotate-90",
                  )}
                />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionRowCard({
  row,
  localePath,
  avgVisitTiins,
}: {
  row: ActionRow;
  localePath: (path: string) => string;
  avgVisitTiins: number | null;
}) {
  const td = useTranslations("actionCenter.dashboard.actionsList");
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const meta = ACTION_CTA[row.type];
  const Icon = meta.Icon;
  const title = formatActionTitle(t, row.payload, locale);
  const body = formatActionBody(t, row.payload, locale);

  // The entity the task is about, derived from the payload (audit AC-14):
  // rows stored before carried dead paths like /crm/payments.
  const deeplink = actionRowDeeplinkPath(row);
  // For the реактивация wizard the deeplink carries the bucket; we also need
  // the action id so the launch endpoint can close this card on success.
  const deeplinkWithActionId =
    row.type === "DORMANT_BATCH"
      ? `${deeplink}${deeplink.includes("?") ? "&" : "?"}actionId=${row.id}`
      : deeplink;
  const href = localePath(deeplinkWithActionId);

  const priceTiins = pricePerAction(row, avgVisitTiins);
  const priorityKey =
    row.severity === "critical"
      ? "priorityCritical"
      : row.severity === "high"
        ? "priorityHigh"
        : row.severity === "medium"
          ? "priorityMedium"
          : "priorityLow";

  const ctaLabelKey: keyof IntlMessages["actionCenter"]["dashboard"]["actionsList"] =
    meta.cta;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3 transition-colors hover:bg-muted/30">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          TONE_CHIP[meta.tone],
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {title}
        </p>
        {body ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{body}</p>
        ) : null}
      </div>
      {priceTiins !== null ? (
        <div className="hidden shrink-0 text-right md:block">
          <div className="text-sm font-bold tabular-nums text-success">
            +<MoneyText amount={priceTiins} currency="UZS" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {td("potentialRevenuePrefix")
              ? td("potentialRevenuePrefix") === "+"
                ? ""
                : ""
              : ""}
            {/* hint already lives below; keep markup minimal */}
          </p>
        </div>
      ) : null}
      <span
        className={cn(
          "hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide lg:inline-flex",
          SEVERITY_PILL[row.severity],
        )}
      >
        {td(priorityKey)}
      </span>
      <Link
        href={href}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
          ctaToneClass(meta.tone),
        )}
      >
        <Icon className="size-3.5" />
        {td(ctaLabelKey)}
      </Link>
      <ActionMenu row={row} />
    </div>
  );
}

/**
 * The money a task is about, from data only (audit AC-15): the slot's
 * estimate, the debt itself, a visit's average price, the expected loss on a
 * no-show risk. A dormant segment and an overloaded queue used to be priced
 * with invented shares of a visit (5% and 10%); they have no amount now.
 */
function pricePerAction(
  row: ActionRow,
  avgVisitTiins: number | null,
): number | null {
  const p = row.payload;
  switch (p.type) {
    case "EMPTY_SLOT_TOMORROW":
      return p.estimatedRevenueLossUzs;
    case "PAYMENT_OVERDUE":
      return p.amountUzs;
    case "UNCONFIRMED_24H":
      return avgVisitTiins;
    case "NO_SHOW_RISK_HIGH":
      return avgVisitTiins === null
        ? null
        : Math.round(avgVisitTiins * (p.risk || 0));
    default:
      return null;
  }
}

function ctaToneClass(tone: keyof typeof TONE_CHIP): string {
  switch (tone) {
    case "primary":
      return "bg-primary text-primary-foreground hover:bg-primary/90";
    case "success":
      return "bg-success text-success-foreground hover:bg-success/90";
    case "danger":
      return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
    case "warning":
      return "bg-warning text-[color:var(--warning-foreground)] hover:brightness-95";
    case "violet":
      return "bg-violet text-violet-foreground hover:brightness-95";
    case "pink":
      return "bg-pink text-pink-foreground hover:brightness-95";
    case "info":
    default:
      return "bg-info text-info-foreground hover:brightness-95";
  }
}

function ActionMenu({ row }: { row: ActionRow }) {
  const t = useTranslations("actionCenter.actions");
  const tac = useTranslations("actionCenter");
  const td = useTranslations("actionCenter.dashboard.actionsList");
  const locale = useLocale() as Locale;
  const [open, setOpen] = React.useState(false);

  const done = useDoneAction();
  const dismiss = useDismissAction();
  const snooze = useSnoozeAction();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={td("menuLabel")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <button
          type="button"
          onClick={async () => {
            setOpen(false);
            try {
              await done.mutateAsync({ id: row.id });
              toast.success(t("doneSuccess"));
            } catch (e) {
              toast.error(
                t("doneError", {
                  reason: e instanceof Error ? e.message : "Error",
                }),
              );
            }
          }}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("done")}
        </button>
        <button
          type="button"
          onClick={async () => {
            setOpen(false);
            // The row leaves the list optimistically; without a toast a
            // failed request looked like success and the row just came back.
            try {
              const after = await snooze.mutateAsync({
                id: row.id,
                preset: "tomorrow",
              });
              toast.success(
                tac("snooze.success", {
                  until: after.snoozeUntil
                    ? formatClinicDateTime(after.snoozeUntil, locale)
                    : tac("snooze.tomorrow"),
                }),
              );
            } catch (e) {
              toast.error(
                tac("snooze.error", {
                  reason: e instanceof Error ? e.message : "Error",
                }),
              );
            }
          }}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("snooze")}
        </button>
        <button
          type="button"
          onClick={async () => {
            setOpen(false);
            try {
              await dismiss.mutateAsync({ id: row.id });
              toast.success(tac("dismiss.success"));
            } catch (e) {
              toast.error(
                tac("dismiss.error", {
                  reason: e instanceof Error ? e.message : "Error",
                }),
              );
            }
          }}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("dismiss")}
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Right rail
// ────────────────────────────────────────────────────────────────────────────

function AiRecs({
  buckets,
  hasCallCenter,
  hasTelegramInbox,
  canReactivate,
}: {
  buckets: Buckets;
  hasCallCenter: boolean;
  hasTelegramInbox: boolean;
  canReactivate: boolean;
}) {
  const td = useTranslations("actionCenter.dashboard.aiRecs");
  const tdal = useTranslations("actionCenter.dashboard.actionsList");
  const locale = useLocale() as Locale;

  const dormantCount = buckets.dormantPatients;

  // Each rec routes to the surface that helps the operator act on it; hrefs
  // mirror the QuickActionsGrid so the same intent always lands in the same
  // place. No figure here without a source (audit AC-15): the free-slot hint
  // used to name the most overloaded doctor, or simply the first one, and the
  // Telegram and dormant hints quoted a made-up «+35% конверсии» and a 60-day
  // threshold the detector does not use.
  const recs = [
    {
      title: td("rec1Title"),
      body: td("rec1Body", { count: buckets.unconfirmed }),
      cta: tdal("ctaCall"),
      tone: "primary" as const,
      href: hasCallCenter ? "/crm/call-center" : "/crm/appointments?bucket=unconfirmed",
    },
    {
      title: td("rec2Title"),
      body: td("rec2Body", {
        revenue: formatTiins(buckets.freeSlotsRevTiins, locale),
      }),
      cta: tdal("ctaFillSlots"),
      tone: "success" as const,
      href: `/crm/calendar?date=${addTashkentDays(tashkentToday(), 1)}`,
    },
    ...(hasTelegramInbox
      ? [
          {
            title: td("rec3Title"),
            body: td("rec3Body"),
            cta: tdal("ctaTelegram"),
            tone: "primary" as const,
            href: "/crm/telegram",
          },
        ]
      : []),
    ...(canReactivate
      ? [
          {
            title: td("rec4Title"),
            body: td("rec4Body", { count: dormantCount }),
            cta: tdal("ctaReactivation"),
            tone: "violet" as const,
            href: REACTIVATION_HREF,
          },
        ]
      : []),
  ];

  return (
    <InDevelopment active={!AI_ENABLED}>
    <section className="motion-rise-in rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      </header>
      <ol className="motion-stagger mt-3 space-y-3">
        {recs.map((rec, i) => (
          <li key={i} className="motion-rise-in flex items-start gap-2">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {rec.title}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {rec.body}
              </p>
              <Link
                href={`/${locale}${rec.href}`}
                className={cn(
                  "motion-press mt-1.5 inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                  ctaToneClass(rec.tone),
                )}
              >
                {rec.cta}
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
    </InDevelopment>
  );
}

/**
 * Where «Запустить реактивацию» leads (audit UX-09): the reactivation
 * wizard, which buckets patients by `lastVisitAt` exactly as the
 * DORMANT_BATCH tasks behind the «N пациентов без визита более 90 дней» hint
 * count them, and previews how many of them it can reach. The dormant
 * segment list it used to open filters on the stored `Patient.segment`,
 * which nothing recalculates (PT-15), so it was always empty. Launching a
 * campaign is an admin's, like the DORMANT_BATCH task, so only admins get
 * the link.
 */
const REACTIVATION_HREF = "/crm/notifications/campaigns/new";

/**
 * Quick actions (audit UX-09, AC-14). Every tile opens a working screen in
 * the viewer's language: the links used to drop the locale (an uz user
 * landed in ru), «Запустить реактивацию» sent `segment=dormant`, which the
 * patients API refuses (400), and «Рассылка Telegram» opened the
 * notification log, where nothing reads `compose`. Now reactivation opens
 * the reactivation wizard (`REACTIVATION_HREF`) for whoever can launch it,
 * and the broadcast tile, shown only to whoever can broadcast, opens the
 * Telegram inbox with the broadcast dialog up. «Начать обзвон» goes to the
 * Call Center when the plan has it, else to the risk list on this page.
 */
function QuickActionsGrid({
  hasCallCenter,
  canBroadcast,
  canReactivate,
}: {
  hasCallCenter: boolean;
  canBroadcast: boolean;
  canReactivate: boolean;
}) {
  const td = useTranslations("actionCenter.dashboard.quickActions");
  const locale = useLocale();
  const tiles = [
    ...(canBroadcast
      ? [
          {
            key: "telegram",
            label: td("telegramBroadcast"),
            icon: <SendIcon className="size-5" />,
            tone: "primary" as const,
            href: `/${locale}/crm/telegram?compose=broadcast`,
          },
        ]
      : []),
    {
      key: "call",
      label: td("startCall"),
      icon: <PhoneIcon className="size-5" />,
      tone: "info" as const,
      href: hasCallCenter ? `/${locale}/crm/call-center` : "#risk-today",
    },
    {
      key: "fill",
      label: td("fillSlots"),
      icon: <CalendarClockIcon className="size-5" />,
      tone: "success" as const,
      href: `/${locale}/crm/calendar?date=${addTashkentDays(tashkentToday(), 1)}`,
    },
    ...(canReactivate
      ? [
          {
            key: "reactivate",
            label: td("startReactivation"),
            icon: <RefreshCwIcon className="size-5" />,
            tone: "violet" as const,
            href: `/${locale}${REACTIVATION_HREF}`,
          },
        ]
      : []),
  ];
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={tile.href}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background/40 p-3 text-center transition-colors hover:bg-muted/40"
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                TONE_CHIP[tile.tone],
              )}
            >
              {tile.icon}
            </span>
            <span className="text-[11px] font-medium text-foreground">
              {tile.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * «Потери сегодня» (audit AC-15): only today, and money only where the data
 * gives it. Tomorrow's free slots are gone from here (they have their own
 * tile), and the missed requests and calls are counts: their «expected
 * recovery» was an invented share of a visit. The no-show row is the
 * expected loss, Σ risk × the clinic's average visit price, or «нет данных»
 * without one.
 */
function TodayLosses({
  buckets,
  missedToday,
  hasCallCenter,
}: {
  buckets: Buckets;
  missedToday: { calls: number; requests: number } | undefined;
  hasCallCenter: boolean;
}) {
  const td = useTranslations("actionCenter.dashboard.todayLosses");
  const tk = useTranslations("actionCenter.dashboard.kpi");
  const locale = useLocale();
  const missedRequests = missedToday?.requests ?? 0;
  const missedCalls = missedToday?.calls ?? 0;

  const rowClass =
    "-mx-1 flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-xs";
  const linkClass = cn(
    rowClass,
    "motion-press group transition-colors hover:bg-muted/50",
  );

  const countRows = [
    {
      key: "requests",
      label: td("missedRequests"),
      count: missedRequests,
      href: `/${locale}/crm/online-requests`,
    },
    {
      key: "calls",
      label: td("missedCalls"),
      count: missedCalls,
      // Missed calls live in the Call Center; without it there is no page.
      href: hasCallCenter ? `/${locale}/crm/call-center` : null,
    },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center gap-2">
        <ClockIcon className="size-4 text-destructive" />
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      </header>
      <ul className="mt-3 space-y-1">
        <li>
          <Link href="#risk-today" className={linkClass} title={td("noShowRiskHint")}>
            <span className="flex items-baseline gap-1.5 text-muted-foreground group-hover:text-foreground">
              {td("noShowRisk")}
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                ×{buckets.noShowRisk}
              </span>
            </span>
            {buckets.noShowLossTiins === null ? (
              <span className="text-muted-foreground">{tk("noData")}</span>
            ) : (
              <span className="font-semibold tabular-nums text-destructive">
                <MoneyText amount={buckets.noShowLossTiins} currency="UZS" />
              </span>
            )}
          </Link>
        </li>
        {countRows.map((r) => {
          const inner = (
            <>
              <span className="text-muted-foreground group-hover:text-foreground">
                {r.label}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {r.count}
              </span>
            </>
          );
          return (
            <li key={r.key}>
              {r.href ? (
                <Link href={r.href} className={linkClass}>
                  {inner}
                </Link>
              ) : (
                <div className={rowClass}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Bottom row — doctors load
// ────────────────────────────────────────────────────────────────────────────

/**
 * «Загрузка врачей на сегодня» (audit AC-15): booked minutes against each
 * doctor's working time by the schedule, for every doctor working or booked
 * today (`/api/crm/action-center/doctors-load`). It used to divide the
 * count of all today's rows, cancelled ones included, by a fixed 16, for the
 * first five doctors only.
 */
function DoctorsLoad() {
  const td = useTranslations("actionCenter.dashboard.doctorsLoad");
  const locale = useLocale() as Locale;
  const { data: loadRows = [], isLoading } = useDoctorsLoad();

  const rows = React.useMemo(() => {
    return loadRows.map((doc) => {
      const pct = doc.loadPct;
      const tone =
        pct === null
          ? "muted"
          : pct >= 100
            ? "danger"
            : pct >= 80
              ? "warning"
              : pct >= 40
                ? "success"
                : "info";
      const statusLabel =
        pct === null
          ? td("statusNoSchedule")
          : pct >= 100
            ? td("statusOverloaded")
            : pct >= 80
              ? td("statusHigh")
              : pct >= 40
                ? td("statusNormal")
                : td("statusFree");
      return {
        id: doc.id,
        name: locale === "uz" ? doc.nameUz : doc.nameRu,
        spec:
          locale === "uz" ? doc.specializationUz : doc.specializationRu,
        booked: doc.booked,
        hours: Math.round((doc.workingMinutes / 60) * 10) / 10,
        pct,
        tone,
        statusLabel,
      };
    });
  }, [loadRows, locale, td]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      </header>
      {!isLoading && rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{td("empty")}</p>
      ) : null}
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 text-xs">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
              {initials(r.name)}
            </span>
            <div className="min-w-0 flex-[1.2]">
              <p className="truncate font-semibold text-foreground">{r.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {r.spec ?? ""}
              </p>
            </div>
            <div className="hidden flex-1 sm:block">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    r.tone === "danger"
                      ? "bg-destructive"
                      : r.tone === "warning"
                        ? "bg-warning"
                        : r.tone === "success"
                          ? "bg-success"
                          : "bg-info",
                  )}
                  style={{ width: `${Math.min(100, r.pct ?? 0)}%` }}
                />
              </div>
            </div>
            {r.pct === null ? null : (
              <span className="shrink-0 font-bold tabular-nums text-foreground">
                {r.pct}%
              </span>
            )}
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                r.tone === "danger"
                  ? "bg-destructive/15 text-destructive"
                  : r.tone === "warning"
                    ? "bg-warning/20 text-[color:var(--warning-foreground)]"
                    : r.tone === "success"
                      ? "bg-success/15 text-[color:var(--success)]"
                      : r.tone === "muted"
                        ? "bg-muted text-muted-foreground"
                        : "bg-info/15 text-[color:var(--info)]",
              )}
            >
              {r.statusLabel}
            </span>
            <span
              className="shrink-0 font-semibold tabular-nums text-muted-foreground"
              title={r.hours > 0 ? td("workingHours", { hours: r.hours }) : undefined}
            >
              {td("visits", { count: r.booked })}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-center border-t border-border pt-2">
        <Link
          href={`/${locale}/crm/calendar`}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {td("openSchedule")}
        </Link>
      </div>
    </section>
  );
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function formatTiins(amountTiins: number, locale: Locale): string {
  // Simple thousand-separated UZS for inline interpolation in i18n bodies.
  const uzs = Math.round(amountTiins / 100);
  const fmt = new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    maximumFractionDigits: 0,
  });
  return `${fmt.format(uzs)} ${locale === "uz" ? "so'm" : "сум"}`;
}
