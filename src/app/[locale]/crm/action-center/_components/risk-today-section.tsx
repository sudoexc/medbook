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
 *   - reminder-cascade context chip («3 напоминания · не подтвердил»)
 *   - inline CTAs: call, outcome menu («Обработано»), snooze
 *
 * `Обработано` opens a six-outcome menu (TZ-risk-outcomes §1/§5): each
 * outcome is POSTed to every open Action attached to this appointment
 * (NO_SHOW_RISK_HIGH + UNCONFIRMED_24H) and drives the right durable domain
 * action server-side, so the row stops resurrecting on the engine recompute.
 * Optimistic removal from cache so the row disappears immediately; the
 * server response then drives the authoritative refetch.
 *
 * Resolved rows land in the collapsible «Обработано сегодня» trail at the
 * bottom — nothing vanishes into a void anymore.
 */
import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlarmClockIcon,
  AlertTriangleIcon,
  BanIcon,
  BellRingIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  ClockIcon,
  FlameIcon,
  HourglassIcon,
  MessageCircleOffIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  PhoneMissedIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/format";

import { useSnoozeAction } from "../_hooks/use-actions";
import {
  RISK_TODAY_KEY,
  dropRiskRowFromCache,
  useMarkPatientContacted,
  useRecordOutcome,
  useRiskToday,
  type HandledRow,
  type RiskOutcome,
  type RiskReason,
  type RiskTodayRow,
} from "../_hooks/use-risk-today";
import { useRiskTodayFilters } from "../_hooks/use-risk-today-filters";
import { RiskTodayFiltersBar } from "./risk-today-filters";

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

  // Filters: three independent axes (doctor / category / service) combined
  // with AND. Facets are derived from the unfiltered row set so chip counts
  // stay stable while the user clicks.
  const filtersApi = useRiskTodayFilters(data?.appointments, locale);
  const visibleRows = filtersApi.filteredRows;
  const visible = visibleRows.length;
  const filterActive = filtersApi.activeCount > 0;

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

      {/* Filter toolbar — only when there's actually something to filter. */}
      {open > 0 ? <RiskTodayFiltersBar api={filtersApi} /> : null}

      <div className="mt-4">
        {query.isLoading ? (
          <RiskSkeleton />
        ) : query.error ? (
          <ErrorState message={query.error.message} />
        ) : open === 0 ? (
          <EmptyState allDone={allDone} t={t} />
        ) : visible === 0 ? (
          <NoMatchState onReset={() => filtersApi.reset()} />
        ) : (
          <>
            {filterActive ? (
              <p className="mb-2 text-xs text-muted-foreground">
                {t("filteredCount", { visible, total: open })}
              </p>
            ) : null}
            <RiskList rows={visibleRows} locale={locale} />
          </>
        )}
      </div>

      {/* Resolved trail. Expandable so the receptionist can see WHO was
          handled, with what outcome and by whom — the "client doesn't
          vanish" half of TZ-risk-outcomes §5. */}
      {data && (handled > 0 || data.handled.length > 0) ? (
        <HandledToday items={data.handled} count={handled} locale={locale} />
      ) : null}
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

function NoMatchState({ onReset }: { onReset: () => void }) {
  const t = useTranslations("actionCenter.dashboard.riskToday.filters");
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">
        {t("noMatchTitle")}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        {t("noMatchHint")}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("reset")}
      </button>
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
  const router = useRouter();
  const qc = useQueryClient();
  const snooze = useSnoozeAction();
  const recordOutcome = useRecordOutcome();
  const markContacted = useMarkPatientContacted();
  const [busy, setBusy] = React.useState(false);

  // A row carries `no_contact` whenever the patient hasn't been touched in
  // N+ days. Closing the attached detector actions alone isn't enough to
  // silence it — `Patient.lastContactedAt` has to advance too. Otherwise
  // the next risk-today refetch resurrects the same row.
  const hasNoContactReason = row.reasons.some((r) => r.kind === "no_contact");

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
  const patientHref = `/${locale}/crm/patients/${row.patientId}`;
  const apptHref = `/${locale}/crm/appointments/${row.appointmentId}`;

  // Records the call outcome on every attached Action (TZ-risk-outcomes §1).
  // The mutation optimistically drops the row from the cache in onMutate;
  // for a pure no_contact row (no detector Actions) we drop it ourselves.
  const onOutcome = async (input: {
    outcome: RiskOutcome;
    note?: string;
    callbackAt?: string;
  }) => {
    if (busy) return;
    setBusy(true);
    try {
      const writes: Array<Promise<unknown>> = [];
      if (row.actionIds.length > 0) {
        writes.push(
          recordOutcome.mutateAsync({
            actionIds: row.actionIds,
            appointmentId: row.appointmentId,
            ...input,
          }),
        );
      } else {
        dropRiskRowFromCache(qc, row.appointmentId, true);
      }
      // Stamp lastContactedAt whenever the row surfaced (also) from the
      // no_contact signal — without this the receptionist records the
      // outcome but the row keeps coming back on the next refetch.
      if (hasNoContactReason) {
        writes.push(
          markContacted.mutateAsync({
            patientId: row.patientId,
            appointmentId: row.appointmentId,
          }),
        );
      }
      if (writes.length === 0) {
        // Nothing to close on the server (no actions, no no_contact). Just
        // refresh — this branch is mostly defensive; the row reached the UI
        // because at least one reason matched.
        await qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
      } else {
        await Promise.all(writes);
      }
      // «Перенести» = record the outcome + jump into the appointment drawer.
      // The actual date move happens there; reminders reschedule on save.
      if (input.outcome === "RESCHEDULED") {
        router.push(
          `/${locale}/crm/appointments?ap=${row.appointmentId}&from=risk-today`,
        );
      }
      toast.success(
        t("outcomeMenu.success", { outcome: t(`outcome.${input.outcome}`) }),
      );
    } catch (e) {
      toast.error(
        t("outcomeMenu.error", {
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
    dropRiskRowFromCache(qc, row.appointmentId, false);
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
          {/* Reminder-cascade context: how many TG reminders already went
              out + whether the patient confirmed — so the receptionist
              knows the story before dialing. */}
          {row.remindersSent > 0 ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                row.confirmed
                  ? "bg-success/15 text-[color:var(--success)]"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <BellRingIcon className="size-3" />
              {row.confirmed
                ? t("remindersChip.confirmed", { count: row.remindersSent })
                : t("remindersChip.notConfirmed", { count: row.remindersSent })}
            </span>
          ) : null}
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
        <OutcomeMenu
          rowKey={row.appointmentId}
          busy={busy}
          onSelect={(input) => void onOutcome(input)}
        />
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

/** Menu-item descriptors for the six outcomes. `form` = needs extra input
 *  (date and/or note) collected in a second popover view before firing. */
const OUTCOME_ITEMS: Array<{
  outcome: RiskOutcome;
  icon: React.ComponentType<{ className?: string }>;
  form: "callback" | "return" | "refused" | null;
}> = [
  { outcome: "CONFIRMED", icon: CheckIcon, form: null },
  { outcome: "RESCHEDULED", icon: CalendarClockIcon, form: null },
  { outcome: "CALLBACK", icon: AlarmClockIcon, form: "callback" },
  { outcome: "RETURN_LATER", icon: CalendarDaysIcon, form: "return" },
  { outcome: "REFUSED", icon: BanIcon, form: "refused" },
  { outcome: "NO_ANSWER", icon: PhoneMissedIcon, form: null },
];

/**
 * The «Обработано» split control: primary click opens a popover with the six
 * call outcomes. CONFIRMED / RESCHEDULED / NO_ANSWER fire immediately;
 * CALLBACK / RETURN_LATER / REFUSED switch to an inline form (date-time /
 * date + note) because the server requires `callbackAt` for the snoozes and
 * the refusal reason is what makes REFUSED auditable.
 */
function OutcomeMenu({
  rowKey,
  busy,
  onSelect,
}: {
  /** Stable id suffix so input/label pairs stay unique per row. */
  rowKey: string;
  busy: boolean;
  onSelect: (input: {
    outcome: RiskOutcome;
    note?: string;
    callbackAt?: string;
  }) => void;
}) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<"callback" | "return" | "refused" | null>(null);
  const [at, setAt] = React.useState(""); // yyyy-MM-ddTHH:mm | yyyy-MM-dd
  const [note, setNote] = React.useState("");

  const reset = () => {
    setForm(null);
    setAt("");
    setNote("");
  };

  const fire = (input: {
    outcome: RiskOutcome;
    note?: string;
    callbackAt?: string;
  }) => {
    setOpen(false);
    reset();
    onSelect(input);
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (form === "refused") {
      if (!trimmed) return;
      fire({ outcome: "REFUSED", note: trimmed });
      return;
    }
    if (!at) return;
    // datetime-local / date values are clinic-local wall time in the
    // receptionist's browser; the schema wants a strict ISO instant.
    fire({
      outcome: form === "callback" ? "CALLBACK" : "RETURN_LATER",
      callbackAt: new Date(at).toISOString(),
      note: trimmed || undefined,
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-success px-2.5 py-1.5 text-xs font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
          title={t("ctaHandledTitle")}
        >
          <CheckIcon className="size-3.5" />
          <span className="hidden sm:inline">{t("ctaHandled")}</span>
          <ChevronDownIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {form === null ? (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("outcomeMenu.title")}
            </div>
            {OUTCOME_ITEMS.map(({ outcome, icon: Icon, form: target }) => (
              <button
                key={outcome}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (target) {
                    setForm(target);
                  } else {
                    fire({ outcome });
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t(`outcome.${outcome}`)}
                </span>
                {outcome === "RESCHEDULED" ? (
                  <span className="text-[10px] text-muted-foreground">
                    {t("outcomeMenu.opensDrawer")}
                  </span>
                ) : null}
              </button>
            ))}
          </>
        ) : (
          <form onSubmit={submitForm} className="space-y-2 p-2">
            <div className="text-xs font-semibold text-foreground">
              {form === "callback"
                ? t("outcome.CALLBACK")
                : form === "return"
                  ? t("outcome.RETURN_LATER")
                  : t("outcome.REFUSED")}
            </div>
            {form !== "refused" ? (
              <div className="space-y-1">
                <Label
                  htmlFor={`outcome-${rowKey}-at`}
                  className="text-xs text-muted-foreground"
                >
                  {form === "callback"
                    ? t("outcomeMenu.callbackAtLabel")
                    : t("outcomeMenu.returnAtLabel")}
                </Label>
                <Input
                  id={`outcome-${rowKey}-at`}
                  type={form === "callback" ? "datetime-local" : "date"}
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label
                htmlFor={`outcome-${rowKey}-note`}
                className="text-xs text-muted-foreground"
              >
                {form === "refused"
                  ? t("outcomeMenu.reasonLabel")
                  : t("outcomeMenu.noteLabel")}
              </Label>
              <Textarea
                id={`outcome-${rowKey}-note`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={
                  form === "refused"
                    ? t("outcomeMenu.reasonPlaceholder")
                    : t("outcomeMenu.notePlaceholder")
                }
                className="min-h-14 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={reset}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("outcomeMenu.back")}
              </button>
              <button
                type="submit"
                disabled={
                  busy || (form === "refused" ? note.trim() === "" : at === "")
                }
                className="flex-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {t("outcomeMenu.confirm")}
              </button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * «Обработано сегодня (N)» — the resolved trail. Expands into the list of
 * rows worked today: who, with what outcome, the note, the promised callback
 * time and which teammate closed it. This is what stops handled clients from
 * "vanishing" — the work stays visible for the whole shift.
 */
function HandledToday({
  items,
  count,
  locale,
}: {
  items: HandledRow[];
  count: number;
  locale: Locale;
}) {
  const t = useTranslations("actionCenter.dashboard.riskToday");
  const [expanded, setExpanded] = React.useState(false);

  // No enriched rows to show (legacy DONE actions without an outcome) — keep
  // the plain counter so the header math still adds up.
  if (items.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold text-muted-foreground">
        {t("handledList.title", { count })}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
          <CheckIcon className="size-3.5 text-[color:var(--success)]" />
          {t("handledList.title", { count })}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <ul className="divide-y divide-border border-t border-border bg-background/40">
          {items.map((h) => (
            <li
              key={h.appointmentId}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs"
            >
              <span className="font-semibold text-foreground">
                {h.patientName}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground">
                {h.outcome ? t(`outcome.${h.outcome}`) : t("ctaHandled")}
              </span>
              {h.outcomeNote ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  «{h.outcomeNote}»
                </span>
              ) : null}
              {h.callbackAt ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--warning-foreground)]">
                  <AlarmClockIcon className="size-3" />
                  {t("handledList.callbackAt", {
                    at: formatDateTimeInClinic(h.callbackAt, locale),
                  })}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-baseline gap-1.5 text-muted-foreground">
                {h.resolvedByName ? <span>{h.resolvedByName}</span> : null}
                <span className="tabular-nums">
                  {formatTimeInClinic(h.handledAt, locale)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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

/** Like `formatTimeInClinic` but with the calendar date — callbackAt can be
 *  days away («хочет прийти позже»), so time alone would mislead. */
function formatDateTimeInClinic(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Tashkent",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
