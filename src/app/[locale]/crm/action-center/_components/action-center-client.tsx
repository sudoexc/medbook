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
  MailIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  RefreshCcwIcon,
  RefreshCwIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  TrendingDownIcon,
  UsersIcon,
  ZapIcon,
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
import {
  ACTION_ICONS,
} from "@/lib/actions/icons";
import { formatActionTitle, formatActionBody } from "@/lib/actions/format";
import {
  defaultDeeplinkPath,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actions/types";
import type { Locale } from "@/lib/format";

import {
  useActionsPaged,
  useDoneAction,
  useDismissAction,
  useRecomputeActions,
  useSnoozeAction,
  useActionsSla,
  type ActionRow,
} from "../_hooks/use-actions";
import { RiskTodaySection } from "./risk-today-section";
import { AnimatedDuration } from "@/components/motion/animated-time";
import {
  useReceptionDashboard,
  useActiveDoctors,
  useTodayAppointments,
  type DoctorRef,
} from "../../reception/_hooks/use-reception-live";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR"
  | null;

// Fallback average visit price (in tiins, 80 000 сум) — used only when the
// clinic has no COMPLETED appointments in the last 90 days. Real value comes
// from `DashboardResponse.avgVisitTiins`.
const FALLBACK_AVG_VISIT_TIINS = 8_000_000;
const NO_SHOW_RISK_FACTOR = 0.6; // assume ~60% revenue loss when a high-risk patient no-shows

// Expected-recovery coefficients (share of an average visit price that a
// missed touchpoint would have brought in if handled). These reflect the
// industry conversion estimate the product team agreed on: an online request
// converts at ~40 %, a missed call at ~22.5 %.
const REQUEST_RECOVERY_RATE = 0.4;
const CALL_RECOVERY_RATE = 0.225;

export interface ActionCenterClientProps {
  role: Role;
}

export function ActionCenterClient({ role }: ActionCenterClientProps) {
  const t = useTranslations("actionCenter");
  const td = useTranslations("actionCenter.dashboard");
  const locale = useLocale() as Locale;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const { rows: actions, isLoading } = useActionsPaged({
    status: ["OPEN"],
    limit: 50,
  });
  const { data: dashboard } = useReceptionDashboard();
  const { data: doctors = [] } = useActiveDoctors();
  const { data: todayApts = [] } = useTodayAppointments();

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

  const avgVisitTiins =
    dashboard?.avgVisitTiins && dashboard.avgVisitTiins > 0
      ? dashboard.avgVisitTiins
      : FALLBACK_AVG_VISIT_TIINS;

  const buckets = React.useMemo(
    () => bucketActions(actions, avgVisitTiins),
    [actions, avgVisitTiins],
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
          <KpiStrip buckets={buckets} />
          <ActionsList
            actions={actions}
            isLoading={isLoading}
            localePath={localePath}
            avgVisitTiins={avgVisitTiins}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <TasksQueue actions={actions} />
            <DoctorsLoad doctors={doctors} todayApts={todayApts} />
          </div>
        </div>
        <aside className="flex flex-col gap-5">
          <ResponseTimeTile />
          <AiRecs buckets={buckets} doctors={doctors} />
          <QuickActionsGrid />
          <TodayLosses
            buckets={buckets}
            missedToday={dashboard?.missedToday}
            avgVisitTiins={avgVisitTiins}
          />
        </aside>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Bucketing actions for KPI math + AI recs.
// ────────────────────────────────────────────────────────────────────────────

type Buckets = {
  unconfirmed: ActionRow[];
  freeSlots: ActionRow[];
  noShowRisk: ActionRow[];
  payments: ActionRow[];
  dormant: ActionRow[];
  overload: ActionRow[];
  unconfirmedRevTiins: number;
  freeSlotsRevTiins: number;
  noShowLossTiins: number;
  paymentsLossTiins: number;
};

function bucketActions(rows: ActionRow[], avgVisitTiins: number): Buckets {
  const unconfirmed: ActionRow[] = [];
  const noShowRisk: ActionRow[] = [];
  const freeSlots: ActionRow[] = [];
  const payments: ActionRow[] = [];
  const dormant: ActionRow[] = [];
  const overload: ActionRow[] = [];

  let unconfirmedRevTiins = 0;
  let freeSlotsRevTiins = 0;
  let noShowLossTiins = 0;
  let paymentsLossTiins = 0;

  for (const r of rows) {
    switch (r.type) {
      case "UNCONFIRMED_24H":
        unconfirmed.push(r);
        unconfirmedRevTiins += avgVisitTiins;
        break;
      case "NO_SHOW_RISK_HIGH": {
        noShowRisk.push(r);
        const risk =
          r.payload.type === "NO_SHOW_RISK_HIGH" ? r.payload.risk : 0.5;
        noShowLossTiins += Math.round(
          avgVisitTiins * risk * NO_SHOW_RISK_FACTOR,
        );
        break;
      }
      case "EMPTY_SLOT_TOMORROW":
        freeSlots.push(r);
        if (r.payload.type === "EMPTY_SLOT_TOMORROW") {
          freeSlotsRevTiins += r.payload.estimatedRevenueLossUzs;
        }
        break;
      case "PAYMENT_OVERDUE":
        payments.push(r);
        if (r.payload.type === "PAYMENT_OVERDUE") {
          paymentsLossTiins += r.payload.amountUzs;
        }
        break;
      case "DORMANT_BATCH":
        dormant.push(r);
        break;
      case "DOCTOR_OVERLOAD":
        overload.push(r);
        break;
      default:
        break;
    }
  }

  return {
    unconfirmed,
    freeSlots,
    noShowRisk,
    payments,
    dormant,
    overload,
    unconfirmedRevTiins,
    freeSlotsRevTiins,
    noShowLossTiins,
    paymentsLossTiins,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// KPI strip — 4 tiles
// ────────────────────────────────────────────────────────────────────────────

function KpiStrip({ buckets }: { buckets: Buckets }) {
  const td = useTranslations("actionCenter.dashboard.kpi");
  const locale = useLocale();

  const tiles = [
    {
      key: "unconfirmed",
      label: td("unconfirmed"),
      count: buckets.unconfirmed.length,
      unit: td("unconfirmedUnit"),
      moneyTiins: buckets.unconfirmedRevTiins,
      hint: td("potentialLoss"),
      tone: "warning" as const,
      icon: <UsersIcon className="size-5" />,
      href: `/${locale}/crm/call-center?from=kpi&intent=unconfirmed`,
    },
    {
      key: "freeSlots",
      label: td("freeSlots"),
      count: buckets.freeSlots.length,
      unit: td("freeSlotsUnit"),
      moneyTiins: buckets.freeSlotsRevTiins,
      hint: td("potentialRevenue"),
      tone: "success" as const,
      icon: <CalendarClockIcon className="size-5" />,
      href: `/${locale}/crm/calendar?from=kpi&intent=fill-slots`,
    },
    {
      key: "noShow",
      label: td("noShowRisk"),
      count: buckets.noShowRisk.length,
      unit: td("noShowRiskUnit"),
      moneyTiins: -buckets.noShowLossTiins,
      hint: td("potentialLoss"),
      tone: "pink" as const,
      icon: <TrendingDownIcon className="size-5" />,
      href: `/${locale}/crm/appointments?dateMode=today&bucket=no_show`,
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
  moneyTiins: number;
  hint: string;
  tone: keyof typeof TONE_CHIP;
  icon: React.ReactNode;
  href: string;
}) {
  const isLoss = moneyTiins < 0;
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
  EMPTY_SLOT_TOMORROW: "slots",
  IDLE_ROOM: "slots",
  LOW_DOCTOR_SCHEDULE: "slots",
  PAYMENT_OVERDUE: "payments",
  DORMANT_BATCH: "reactivation",
  CASE_REPEAT_DUE: "reactivation",
  DOCTOR_OVERLOAD: "operations",
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
  isLoading,
  localePath,
  avgVisitTiins,
}: {
  actions: ActionRow[];
  isLoading: boolean;
  localePath: (path: string) => string;
  avgVisitTiins: number;
}) {
  const td = useTranslations("actionCenter.dashboard.actionsList");

  const grouped = React.useMemo(() => groupByCategory(actions), [actions]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">{td("title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {td("subtitle")}
          </p>
        </div>
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums">
          {actions.length}
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
                localePath={localePath}
                avgVisitTiins={avgVisitTiins}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function CategorySection({
  category,
  rows,
  localePath,
  avgVisitTiins,
}: {
  category: CategoryKey;
  rows: ActionRow[];
  localePath: (path: string) => string;
  avgVisitTiins: number;
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
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-foreground">
          {rows.length}
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
  avgVisitTiins: number;
}) {
  const td = useTranslations("actionCenter.dashboard.actionsList");
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const meta = ACTION_CTA[row.type];
  const Icon = meta.Icon;
  const title = formatActionTitle(t, row.payload, locale);
  const body = formatActionBody(t, row.payload, locale);

  const deeplink =
    row.deeplinkPath && row.deeplinkPath.length > 0
      ? row.deeplinkPath
      : defaultDeeplinkPath(row.type);
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

function pricePerAction(row: ActionRow, avgVisitTiins: number): number | null {
  const p = row.payload;
  switch (p.type) {
    case "EMPTY_SLOT_TOMORROW":
      return p.estimatedRevenueLossUzs;
    case "PAYMENT_OVERDUE":
      return p.amountUzs;
    case "UNCONFIRMED_24H":
      return avgVisitTiins;
    case "NO_SHOW_RISK_HIGH":
      return Math.round(avgVisitTiins * NO_SHOW_RISK_FACTOR * (p.risk || 0.5));
    case "DORMANT_BATCH":
      return p.patientCount * Math.round(avgVisitTiins * 0.05);
    case "DOCTOR_OVERLOAD":
      return p.queueLength * Math.round(avgVisitTiins * 0.1);
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
  const td = useTranslations("actionCenter.dashboard.actionsList");
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
            await snooze.mutateAsync({ id: row.id, preset: "tomorrow" });
          }}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("snooze")}
        </button>
        <button
          type="button"
          onClick={async () => {
            setOpen(false);
            await dismiss.mutateAsync({ id: row.id });
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

function ResponseTimeTile() {
  const td = useTranslations("actionCenter.dashboard.responseTime");
  const sla = useActionsSla();
  const overall = sla.data?.overall.avgSeconds ?? null;
  const overallMin = overall != null ? Math.floor(overall / 60) : null;
  const overallSec = overall != null ? overall % 60 : null;
  return (
    <div className="motion-rise-in rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info/15 text-[color:var(--info)]">
          <ClockIcon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {td("title")}
          </p>
          {overall == null ? (
            <p className="mt-1 text-sm text-muted-foreground">—</p>
          ) : (
            <div className="mt-1 flex items-baseline gap-1 tabular-nums">
              <span className="text-2xl font-bold text-foreground">
                {overallMin}
              </span>
              <span className="text-sm text-muted-foreground">{td("min")}</span>
              <span className="ml-1 text-2xl font-bold text-foreground">
                {overallSec}
              </span>
              <span className="text-sm text-muted-foreground">{td("sec")}</span>
            </div>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        <ResponseRow
          icon={<SendIcon className="size-3.5" />}
          label={td("telegram")}
          seconds={sla.data?.telegram.avgSeconds ?? null}
        />
        <ResponseRow
          icon={<MailIcon className="size-3.5" />}
          label={td("feedback")}
          seconds={sla.data?.feedback.avgSeconds ?? null}
        />
        <ResponseRow
          icon={<PhoneIcon className="size-3.5" />}
          label={td("calls")}
          seconds={sla.data?.calls.avgSeconds ?? null}
        />
      </ul>
    </div>
  );
}

function ResponseRow({
  icon,
  label,
  seconds,
}: {
  icon: React.ReactNode;
  label: string;
  seconds: number | null;
}) {
  return (
    <li className="flex items-center justify-between text-xs">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-foreground">
        {seconds == null ? (
          "—"
        ) : (
          <AnimatedDuration seconds={seconds} format="m:ss" />
        )}
      </span>
    </li>
  );
}

function AiRecs({
  buckets,
  doctors,
}: {
  buckets: Buckets;
  doctors: DoctorRef[];
}) {
  const td = useTranslations("actionCenter.dashboard.aiRecs");
  const tdal = useTranslations("actionCenter.dashboard.actionsList");
  const locale = useLocale() as Locale;

  const overloadDoctorName =
    buckets.overload[0]?.payload.type === "DOCTOR_OVERLOAD"
      ? buckets.overload[0].payload.doctorName
      : (doctors[0]?.[locale === "uz" ? "nameUz" : "nameRu"] ?? "—");
  const dormantCount = buckets.dormant.reduce(
    (acc, r) =>
      acc + (r.payload.type === "DORMANT_BATCH" ? r.payload.patientCount : 0),
    0,
  );

  // Each rec routes to the surface that helps the operator act on it; hrefs
  // mirror the QuickActionsGrid so the same intent always lands in the same
  // place. `?from=ai-rec` lets the destination page surface a banner/hint.
  const recs = [
    {
      title: td("rec1Title"),
      body: td("rec1Body", {
        count: buckets.unconfirmed.length,
        revenue: formatTiins(buckets.unconfirmedRevTiins, locale),
      }),
      cta: tdal("ctaCall"),
      tone: "primary" as const,
      href: "/crm/call-center?from=ai-rec&intent=unconfirmed",
    },
    {
      title: td("rec2Title", { doctorName: overloadDoctorName }),
      body: td("rec2Body", {
        revenue: formatTiins(buckets.freeSlotsRevTiins, locale),
      }),
      cta: tdal("ctaFillSlots"),
      tone: "success" as const,
      href: "/crm/calendar?from=ai-rec&intent=fill-slots",
    },
    {
      title: td("rec3Title"),
      body: td("rec3Body"),
      cta: tdal("ctaTelegram"),
      tone: "primary" as const,
      href: "/crm/notifications?compose=telegram&from=ai-rec",
    },
    {
      title: td("rec4Title"),
      body: td("rec4Body", { count: dormantCount }),
      cta: tdal("ctaReactivation"),
      tone: "violet" as const,
      href: "/crm/patients?segment=dormant&from=ai-rec",
    },
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

function QuickActionsGrid() {
  const td = useTranslations("actionCenter.dashboard.quickActions");
  const tiles = [
    {
      key: "telegram",
      label: td("telegramBroadcast"),
      icon: <SendIcon className="size-5" />,
      tone: "primary" as const,
      href: "/crm/notifications?compose=telegram",
    },
    {
      key: "call",
      label: td("startCall"),
      icon: <PhoneIcon className="size-5" />,
      tone: "info" as const,
      href: "/crm/call-center",
    },
    {
      key: "fill",
      label: td("fillSlots"),
      icon: <CalendarClockIcon className="size-5" />,
      tone: "success" as const,
      href: "/crm/calendar",
    },
    {
      key: "reactivate",
      label: td("startReactivation"),
      icon: <RefreshCwIcon className="size-5" />,
      tone: "violet" as const,
      href: "/crm/patients?segment=dormant",
    },
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

function TodayLosses({
  buckets,
  missedToday,
  avgVisitTiins,
}: {
  buckets: Buckets;
  missedToday: { calls: number; requests: number } | undefined;
  avgVisitTiins: number;
}) {
  const td = useTranslations("actionCenter.dashboard.todayLosses");
  const locale = useLocale();
  const missedRequests = missedToday?.requests ?? 0;
  const missedCalls = missedToday?.calls ?? 0;
  // Each row links to the surface where the loss happens — so a receptionist
  // tapping the line can act on it immediately. `from=losses` lets analytics
  // attribute follow-up bookings back to this card.
  const rows = [
    {
      label: td("emptySlots"),
      tiins: buckets.freeSlotsRevTiins,
      count: buckets.freeSlots.length,
      href: `/${locale}/crm/calendar?from=losses&intent=fill-slots`,
    },
    {
      label: td("noShowRisk"),
      tiins: buckets.noShowLossTiins,
      count: buckets.noShowRisk.length,
      href: `/${locale}/crm/appointments?dateMode=today&bucket=no_show&from=losses`,
    },
    {
      label: td("missedRequests"),
      tiins: Math.round(avgVisitTiins * REQUEST_RECOVERY_RATE * missedRequests),
      count: missedRequests,
      href: `/${locale}/crm/online-requests?from=losses`,
    },
    {
      label: td("missedCalls"),
      tiins: Math.round(avgVisitTiins * CALL_RECOVERY_RATE * missedCalls),
      count: missedCalls,
      href: `/${locale}/crm/call-center?from=losses&intent=missed-calls`,
    },
  ];
  const total = rows.reduce((acc, r) => acc + r.tiins, 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center gap-2">
        <ClockIcon className="size-4 text-destructive" />
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      </header>
      <ul className="mt-3 space-y-1">
        {rows.map((r) => (
          <li key={r.label}>
            <Link
              href={r.href}
              className="motion-press group -mx-1 flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-xs transition-colors hover:bg-muted/50"
            >
              <span className="flex items-baseline gap-1.5 text-muted-foreground group-hover:text-foreground">
                {r.label}
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  ×{r.count}
                </span>
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                <MoneyText amount={r.tiins} currency="UZS" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
        <span className="font-semibold text-destructive">{td("totalLabel")}</span>
        <span className="font-bold tabular-nums text-destructive">
          <MoneyText amount={total} currency="UZS" />
        </span>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Bottom row — tasks queue + doctors load
// ────────────────────────────────────────────────────────────────────────────

const SEVERITY_DOT_BG: Record<ActionSeverity, string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground/40",
};

function TasksQueue({ actions }: { actions: ActionRow[] }) {
  const td = useTranslations("actionCenter.dashboard.tasksQueue");
  const tac = useTranslations("actionCenter.dashboard.actionsList");
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? actions : actions.slice(0, 5);
  const tags = visible.map((row, i) => ({
    id: row.id,
    severity: row.severity,
    time: hourSlot(i),
    label: shortLabelForRow(td, row),
    badge:
      row.severity === "critical"
        ? tac("priorityCritical")
        : row.severity === "high"
          ? tac("priorityHigh")
          : row.severity === "medium"
            ? tac("priorityMedium")
            : tac("priorityLow"),
    progress: progressForRow(row),
  }));

  return (
    <section className="motion-rise-in rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary tabular-nums">
          {actions.length}
        </span>
      </header>
      <ul className="mt-3 space-y-2">
        {tags.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 rounded-md px-1 py-1 text-xs"
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums",
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", SEVERITY_DOT_BG[t.severity])}
              />
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
              {t.time}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground">
              {t.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                SEVERITY_PILL[t.severity],
              )}
            >
              {t.badge}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {td("progress", t.progress)}
            </span>
          </li>
        ))}
      </ul>
      {actions.length > 5 ? (
        <div className="mt-3 flex justify-center border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="motion-press inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showAll ? td("showLess") : td("showAll")}
            <ArrowRightIcon
              className={cn(
                "size-3 transition-transform",
                showAll ? "-rotate-90" : "rotate-90",
              )}
            />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function hourSlot(i: number): string {
  const start = 9; // start at 09:00
  const h = (start + i * 1) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

const SHORT_LABEL_TYPES = new Set([
  "UNCONFIRMED_24H",
  "EMPTY_SLOT_TOMORROW",
  "NO_SHOW_RISK_HIGH",
  "DORMANT_BATCH",
  "DOCTOR_OVERLOAD",
  "PAYMENT_OVERDUE",
]);

function shortLabelForRow(
  td: ReturnType<typeof useTranslations>,
  row: ActionRow,
): string {
  if (!SHORT_LABEL_TYPES.has(row.payload.type)) return row.type;
  const values: Record<string, string | number> = {};
  const p = row.payload as Record<string, unknown>;
  if (typeof p.patientName === "string") values.patientName = p.patientName;
  if (typeof p.doctorName === "string") values.doctorName = p.doctorName;
  if (typeof p.patientCount === "number") values.patientCount = p.patientCount;
  const tDynamic = td as unknown as (
    key: string,
    vals: Record<string, string | number>,
  ) => string;
  return tDynamic(`shortLabel.${row.payload.type}`, values);
}

function progressForRow(row: ActionRow): { done: number; total: number } {
  // Without per-action progress data, derive a stable display from the type +
  // current status: OPEN → 0/N, where N is a sensible per-type quota.
  const total =
    row.payload.type === "DORMANT_BATCH"
      ? row.payload.patientCount
      : row.payload.type === "DOCTOR_OVERLOAD"
        ? row.payload.queueLength
        : 1;
  return { done: row.status === "DONE" ? total : 0, total };
}

function DoctorsLoad({
  doctors,
  todayApts,
}: {
  doctors: DoctorRef[];
  todayApts: AppointmentRow[];
}) {
  const td = useTranslations("actionCenter.dashboard.doctorsLoad");
  const locale = useLocale() as Locale;

  const rows = React.useMemo(() => {
    return doctors.slice(0, 5).map((doc) => {
      const apts = todayApts.filter((a) => a.doctor.id === doc.id);
      const booked = apts.length;
      // Capacity: a working day of 8 × 30-min slots = 16 (rough)
      const capacity = 16;
      const pct = Math.round((booked / capacity) * 100);
      const tone =
        pct >= 100
          ? "danger"
          : pct >= 80
            ? "warning"
            : pct >= 40
              ? "success"
              : "info";
      const statusLabel =
        pct >= 100
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
        booked,
        capacity,
        pct,
        tone,
        statusLabel,
      };
    });
  }, [doctors, todayApts, locale, td]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-foreground">{td("title")}</h3>
      </header>
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
                  style={{ width: `${Math.min(100, r.pct)}%` }}
                />
              </div>
            </div>
            <span className="shrink-0 font-bold tabular-nums text-foreground">
              {r.pct}%
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                r.tone === "danger"
                  ? "bg-destructive/15 text-destructive"
                  : r.tone === "warning"
                    ? "bg-warning/20 text-[color:var(--warning-foreground)]"
                    : r.tone === "success"
                      ? "bg-success/15 text-[color:var(--success)]"
                      : "bg-info/15 text-[color:var(--info)]",
              )}
            >
              {r.statusLabel}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
              {td("ratio", { booked: r.booked, capacity: r.capacity })}
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
