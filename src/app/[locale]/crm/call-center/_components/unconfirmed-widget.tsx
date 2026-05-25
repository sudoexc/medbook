"use client";

/**
 * Stage 2.F — "К подтверждению" / "Tasdiqlanishi kerak" widget.
 *
 * Lists every open UNCONFIRMED_24H Action in the clinic, sorted critical →
 * low → appointment time ascending. The detector tier-walks severity as the
 * appointment approaches (see `severityForUnconfirmed24h`); we re-use that
 * palette here so the colour the receptionist sees on the action-center is
 * the same colour they see on the call-center sidebar.
 *
 * Each row offers three quick paths to closing the loop:
 *
 *   - "Позвонить" → opens the patient card (tel: link lives there). We
 *     intentionally don't surface the raw phone string on this widget —
 *     the action payload doesn't carry it, and per Stage 2.F's "UI + hooks
 *     + i18n only" constraint we can't ask the action API for more.
 *   - "Подтвердить" → PATCH /api/crm/appointments/[id]/queue-status with
 *     `{ queueStatus: 'CONFIRMED' }` via the existing `useSetQueueStatus`
 *     mutation. That same mutation also drives the drawer's lifecycle chain,
 *     so the row gets a consistent toast + optimistic update behaviour.
 *   - "Отложить" → calls the existing snooze endpoint with the 'tomorrow'
 *     preset (matches the dropdown default everywhere else in the app).
 *
 * Layout: collapsible card that lives above the 3-column call-center grid
 * so it shares vertical space with the queue/active/rail trio without
 * fighting them for width. Collapses to zero height when there are no open
 * unconfirmed actions — receptionists shouldn't see an "everything is fine"
 * banner taking up real estate.
 */
import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  PhoneIcon,
  ShieldCheckIcon,
  ClockFadingIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/lib/format";
import { type ActionSeverity } from "@/lib/actions/types";

import { useUnconfirmedActions, type UnconfirmedActionRow } from "../_hooks/use-unconfirmed";
import { useSetQueueStatus } from "../../appointments/_hooks/use-appointment";
import { useSnoozeAction } from "../../action-center/_hooks/use-actions";

// Mirrors the action-center palette so a critical row looks identical on
// both surfaces — receptionists shouldn't have to relearn colours.
const SEVERITY_PILL: Record<ActionSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-warning/20 text-[color:var(--warning-foreground)]",
  medium: "bg-info/15 text-[color:var(--info)]",
  low: "bg-muted text-muted-foreground",
};

export function UnconfirmedWidget() {
  const t = useTranslations("callCenter.unconfirmed");
  const tSev = useTranslations("actionCenter.dashboard.actionsList");
  const locale = useLocale() as Locale;
  const { data: rows = [], isLoading } = useUnconfirmedActions();
  const [collapsed, setCollapsed] = React.useState(false);

  if (!isLoading && rows.length === 0) return null;

  return (
    <section
      aria-label={t("ariaLabel")}
      className="border-b border-border bg-card/50"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={!collapsed}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            rows.length > 0 ? "bg-warning/20 text-[color:var(--warning-foreground)]" : "bg-muted text-muted-foreground",
          )}
        >
          <ShieldCheckIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {t("title")}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {t("subtitle", { count: rows.length })}
          </p>
        </div>
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold tabular-nums text-primary">
          {rows.length}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            collapsed ? "-rotate-90" : "",
          )}
        />
      </button>

      {!collapsed ? (
        <div className="max-h-[260px] overflow-y-auto border-t border-border px-3 pb-2 pt-2">
          {isLoading && rows.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("loading")}
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {rows.map((row) => (
                <li key={row.id}>
                  <UnconfirmedRow row={row} locale={locale} tSev={tSev} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function UnconfirmedRow({
  row,
  locale,
  tSev,
}: {
  row: UnconfirmedActionRow;
  locale: Locale;
  tSev: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations("callCenter.unconfirmed");
  const setQueueStatus = useSetQueueStatus(row.payload.appointmentId);
  const snooze = useSnoozeAction();

  const apptAt = React.useMemo(
    () => new Date(row.payload.appointmentAt),
    [row.payload.appointmentAt],
  );
  const relLabel = formatRelativeApptTime(apptAt, locale, t);

  const onConfirm = async () => {
    try {
      await setQueueStatus.mutateAsync("CONFIRMED");
      toast.success(t("toasts.confirmed", { name: row.payload.patientName }));
    } catch (e) {
      toast.error((e as Error).message || t("toasts.confirmFailed"));
    }
  };

  const onSnooze = async () => {
    try {
      await snooze.mutateAsync({ id: row.id, preset: "tomorrow" });
      toast.success(t("toasts.snoozed"));
    } catch (e) {
      toast.error((e as Error).message || t("toasts.snoozeFailed"));
    }
  };

  const severityKey =
    row.severity === "critical"
      ? "priorityCritical"
      : row.severity === "high"
        ? "priorityHigh"
        : row.severity === "medium"
          ? "priorityMedium"
          : "priorityLow";

  const patientHref = `/${locale}/crm/patients/${row.payload.patientId}`;
  const apptHref = `/${locale}/crm/appointments?id=${row.payload.appointmentId}`;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 transition-colors hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={patientHref}
            className="truncate text-[13px] font-semibold text-foreground hover:underline"
          >
            {row.payload.patientName}
          </Link>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              SEVERITY_PILL[row.severity],
            )}
          >
            {tSev(severityKey)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          <ClockIcon className="mr-1 inline size-3 -translate-y-px" aria-hidden />
          {relLabel}
          <span className="mx-1">·</span>
          {row.payload.doctorName}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={patientHref}
          aria-label={t("call")}
          title={t("call")}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-primary transition-colors hover:bg-muted"
        >
          <PhoneIcon className="size-3.5" />
        </Link>
        <Link
          href={apptHref}
          aria-label={t("open")}
          title={t("open")}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-foreground/80 transition-colors hover:bg-muted"
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={onConfirm}
          disabled={setQueueStatus.isPending}
        >
          <CheckIcon className="size-3.5" />
          {t("confirm")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={onSnooze}
          disabled={snooze.isPending}
        >
          <ClockFadingIcon className="size-3.5" />
          {t("snooze")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "сегодня 14:30" / "завтра 09:00" / "через 2 дня, 10:00" / "через 2ч 15м".
 *
 * Pulls the patient-facing copy from the next-intl bundle so localised
 * variants stay in i18n rather than embedded here. Uses calendar-day
 * comparison (not raw 24h offsets) so an appointment at 23:00 today is
 * still "сегодня" even when called at 22:55.
 */
function formatRelativeApptTime(
  at: Date,
  _locale: Locale,
  t: ReturnType<typeof useTranslations>,
): string {
  const now = new Date();
  const hours = (at.getTime() - now.getTime()) / (60 * 60 * 1000);
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  const clock = `${hh}:${mm}`;

  // Imminent: <60 min away — use HH:MM with explicit hours-left chip.
  if (hours < 1 && hours > 0) {
    const mins = Math.max(1, Math.round(hours * 60));
    return t("relative.inMinutes", { clock, mins });
  }

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(at) - startOfDay(now)) / (24 * 60 * 60 * 1000),
  );

  if (diffDays <= 0) return t("relative.today", { clock });
  if (diffDays === 1) return t("relative.tomorrow", { clock });
  return t("relative.inDays", { clock, days: diffDays });
}
