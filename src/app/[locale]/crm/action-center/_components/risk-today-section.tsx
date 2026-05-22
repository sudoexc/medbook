"use client";

/**
 * Сегодня в зоне риска — daily triage section.
 *
 * One row per at-risk appointment scheduled for today. Replaces the old
 * "Под угрозой сегодня" KPI tile, which double-counted no-show + unconfirmed
 * patients across two tiles and dropped users on a flat appointments table
 * with no reasons attached. Each row here carries:
 *
 *   - chronological time + patient + doctor + service so the receptionist
 *     can scan the day top-to-bottom
 *   - explicit reason chips (high-risk / unconfirmed / no-contact) — no
 *     more guessing why a patient surfaced
 *   - composite risk score gauge for at-a-glance triage
 *   - inline CTAs: call, SMS, mark handled, snooze
 *
 * `Mark handled` closes all the open Action rows attached to this
 * appointment (NO_SHOW_RISK_HIGH + UNCONFIRMED_24H), which is the same path
 * the dedicated action card uses. Optimistic removal from cache so the row
 * disappears immediately; the server response then drives the authoritative
 * refetch.
 */
import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClipboardListIcon,
  ClockIcon,
  FlameIcon,
  HourglassIcon,
  MessageCircleOffIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SendIcon,
  ShieldCheckIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import { toast } from "@/components/ui/sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Locale } from "@/lib/format";

import {
  useDoneAction,
  useSnoozeAction,
} from "../_hooks/use-actions";
import {
  RISK_TODAY_KEY,
  useRiskToday,
  type RiskReason,
  type RiskTodayResponse,
  type RiskTodayRow,
} from "../_hooks/use-risk-today";

export interface RiskTodaySectionProps {
  /** Optional anchor id so a KPI tile can deep-link to the section. */
  anchorId?: string;
}

export function RiskTodaySection({ anchorId }: RiskTodaySectionProps) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const locale = useLocale() as Locale;
  const query = useRiskToday();
  const data = query.data;

  const open = data?.appointments.length ?? 0;
  const handled = data?.totals.handledToday ?? 0;
  const total = data?.totals.total ?? 0;
  const loss = data?.totals.estimatedLossTiins ?? 0;

  // Progress is meaningful only when the day already had some risk. Before
  // the first detector run we don't want a misleading 0/0 displayed.
  const showProgress = total > 0;
  const allDone = open === 0 && handled > 0;

  return (
    <section
      id={anchorId}
      className="motion-rise-in rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl",
              open > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-success/15 text-[color:var(--success)]",
            )}
          >
            {open > 0 ? (
              <FlameIcon className="size-5" />
            ) : (
              <ShieldCheckIcon className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">
              {t("title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {open > 0
                ? t("subtitle", { count: open })
                : handled > 0
                  ? t("subtitleAllDone", { count: handled })
                  : t("subtitleEmpty")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showProgress ? (
            <ProgressBadge open={open} handled={handled} total={total} />
          ) : null}
          {open > 0 && loss > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
              <AlertTriangleIcon className="size-3.5" />
              <span className="tabular-nums">
                <MoneyText amount={loss} currency="UZS" />
              </span>
              <span className="hidden text-[10px] font-medium opacity-80 sm:inline">
                {t("lossHint")}
              </span>
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-4">
        {query.isLoading ? (
          <RiskSkeleton />
        ) : query.error ? (
          <ErrorState message={query.error.message} />
        ) : open === 0 ? (
          <EmptyState allDone={allDone} t={t} />
        ) : (
          <RiskList
            rows={data!.appointments}
            locale={locale}
          />
        )}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function ProgressBadge({
  open,
  handled,
  total,
}: {
  open: number;
  handled: number;
  total: number;
}) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const pct = total === 0 ? 0 : Math.round((handled / total) * 100);
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground"
      title={t("progressTitle", { handled, total })}
    >
      <span className="tabular-nums">
        {t("progressLabel", { handled, total })}
      </span>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-background">
        <span
          className="absolute inset-y-0 left-0 bg-success transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums text-[10px] text-muted-foreground">
        {open} {t("openShort")}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function RiskSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-xl border border-border bg-muted/30"
        />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <AlertTriangleIcon className="size-5 shrink-0" />
      <div>
        <p className="font-semibold">{t("errorTitle")}</p>
        <p className="text-xs opacity-80">{message}</p>
      </div>
    </div>
  );
}

function EmptyState({
  allDone,
  t,
}: {
  allDone: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-success/30 bg-success/5 px-4 py-10 text-center">
      <ShieldCheckIcon className="size-10 text-[color:var(--success)]" />
      <p className="text-sm font-semibold text-foreground">
        {allDone ? t("emptyAllDone") : t("empty")}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        {allDone ? t("emptyAllDoneHint") : t("emptyHint")}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function RiskList({
  rows,
  locale,
}: {
  rows: RiskTodayRow[];
  locale: Locale;
}) {
  return (
    <ul className="motion-stagger flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
      {rows.map((row) => (
        <li key={row.appointmentId} className="motion-rise-in bg-background/30">
          <RiskRow row={row} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

function RiskRow({ row, locale }: { row: RiskTodayRow; locale: Locale }) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const tAction = useTranslations("actionCenter.actions");
  const qc = useQueryClient();
  const done = useDoneAction();
  const snooze = useSnoozeAction();
  const [busy, setBusy] = React.useState(false);

  const doctorName = locale === "uz" ? row.doctorName.uz : row.doctorName.ru;
  const serviceName = row.serviceName
    ? locale === "uz"
      ? row.serviceName.uz
      : row.serviceName.ru
    : null;
  const timeLabel = formatTimeInClinic(row.appointmentAt, locale);

  const phoneTel = row.patientPhone
    ? row.patientPhone.replace(/[^\d+]/g, "")
    : null;

  const handlePath = `/${locale}/crm/call-center?from=risk-today&patientId=${row.patientId}&phone=${encodeURIComponent(row.patientPhone ?? "")}`;
  const smsPath = `/${locale}/crm/notifications?compose=sms&patientId=${row.patientId}&intent=confirm&from=risk-today`;
  const patientHref = `/${locale}/crm/patients/${row.patientId}`;
  const apptHref = `/${locale}/crm/appointments/${row.appointmentId}`;

  // Optimistically drop this row from the cached risk-today response so the
  // UI feels instant. Server-driven invalidation re-syncs after the writes.
  const optimisticallyDrop = React.useCallback(() => {
    qc.setQueryData<RiskTodayResponse>(RISK_TODAY_KEY, (prev) => {
      if (!prev) return prev;
      const next = prev.appointments.filter(
        (a) => a.appointmentId !== row.appointmentId,
      );
      return {
        ...prev,
        appointments: next,
        totals: {
          ...prev.totals,
          open: next.length,
          handledToday: prev.totals.handledToday + (next.length < prev.appointments.length ? 1 : 0),
        },
      };
    });
  }, [qc, row.appointmentId]);

  const onMarkHandled = async () => {
    if (busy) return;
    setBusy(true);
    optimisticallyDrop();
    try {
      if (row.actionIds.length === 0) {
        // No detector actions to close — the row only surfaced from the
        // no-contact reason. Just refresh; the receptionist has signalled
        // intent and the row will reappear if conditions still match.
        await qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
      } else {
        await Promise.all(
          row.actionIds.map((id) => done.mutateAsync({ id })),
        );
      }
      toast.success(tAction("doneSuccess"));
    } catch (e) {
      toast.error(
        tAction("doneError", {
          reason: e instanceof Error ? e.message : "Error",
        }),
      );
      await qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
    } finally {
      setBusy(false);
    }
  };

  const onSnoozeAll = async () => {
    if (busy || row.actionIds.length === 0) return;
    setBusy(true);
    optimisticallyDrop();
    try {
      await Promise.all(
        row.actionIds.map((id) =>
          snooze.mutateAsync({ id, preset: "tomorrow" }),
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
      await qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4">
      {/* Time + risk gauge */}
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start sm:gap-1.5">
        <div className="flex items-baseline gap-1 font-bold tabular-nums">
          <ClockIcon className="size-3.5 text-muted-foreground" />
          <span className="text-base text-foreground">{timeLabel}</span>
        </div>
        <RiskGauge score={row.riskScore} />
      </div>

      {/* Patient + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link
            href={patientHref}
            className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
          >
            {row.patientName}
          </Link>
          {phoneTel ? (
            <a
              href={`tel:${phoneTel}`}
              className="truncate text-xs text-muted-foreground hover:text-foreground"
            >
              {row.patientPhone}
            </a>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {doctorName}
          {serviceName ? ` · ${serviceName}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {row.reasons.map((r, i) => (
            <ReasonChip key={i} reason={r} />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Link
          href={handlePath}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          title={t("ctaCallTitle")}
        >
          <PhoneIcon className="size-3.5" />
          <span className="hidden sm:inline">{t("ctaCall")}</span>
        </Link>
        <Link
          href={smsPath}
          className="inline-flex items-center gap-1 rounded-md bg-info px-2.5 py-1.5 text-xs font-semibold text-info-foreground transition-colors hover:brightness-95"
          title={t("ctaSmsTitle")}
        >
          <SendIcon className="size-3.5" />
          <span className="hidden sm:inline">{t("ctaSms")}</span>
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onMarkHandled()}
          className="inline-flex items-center gap-1 rounded-md bg-success px-2.5 py-1.5 text-xs font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
          title={t("ctaHandledTitle")}
        >
          <CheckIcon className="size-3.5" />
          <span className="hidden sm:inline">{t("ctaHandled")}</span>
        </button>
        <RowMenu
          onSnooze={() => void onSnoozeAll()}
          patientHref={patientHref}
          apptHref={apptHref}
          canSnooze={row.actionIds.length > 0}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function ReasonChip({ reason }: { reason: RiskReason }) {
  const t = useTranslations("actionCenter.dashboard.riskToday.reasons");

  if (reason.kind === "high_risk") {
    const pct = Math.round(reason.risk * 100);
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        <AlertTriangleIcon className="size-3" />
        {t("highRisk", { pct })}
      </span>
    );
  }

  if (reason.kind === "unconfirmed_24h") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--warning-foreground)]">
        <HourglassIcon className="size-3" />
        {reason.hoursToAppt >= 1
          ? t("unconfirmedHours", { hours: Math.round(reason.hoursToAppt) })
          : t("unconfirmedSoon")}
      </span>
    );
  }

  // no_contact
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet/15 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--violet)]">
      <MessageCircleOffIcon className="size-3" />
      {reason.daysSinceContact == null
        ? t("noContactNever")
        : t("noContactDays", { days: reason.daysSinceContact })}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function RiskGauge({ score }: { score: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const tone =
    pct >= 70
      ? "bg-destructive text-destructive-foreground"
      : pct >= 50
        ? "bg-warning text-[color:var(--warning-foreground)]"
        : "bg-info/15 text-[color:var(--info)]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
        tone,
      )}
      title={`risk ${pct}%`}
    >
      {pct}%
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function RowMenu({
  onSnooze,
  patientHref,
  apptHref,
  canSnooze,
}: {
  onSnooze: () => void;
  patientHref: string;
  apptHref: string;
  canSnooze: boolean;
}) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("menuLabel")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <button
          type="button"
          disabled={!canSnooze}
          onClick={() => {
            setOpen(false);
            onSnooze();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <ClockIcon className="size-3.5 text-muted-foreground" />
          {t("menuSnooze")}
        </button>
        <Link
          href={patientHref}
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          <UserIcon className="size-3.5 text-muted-foreground" />
          {t("menuOpenPatient")}
        </Link>
        <Link
          href={apptHref}
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          <ClipboardListIcon className="size-3.5 text-muted-foreground" />
          {t("menuOpenAppt")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function formatTimeInClinic(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Tashkent",
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}
