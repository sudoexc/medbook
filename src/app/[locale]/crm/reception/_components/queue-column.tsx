"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AI_ENABLED } from "@/lib/ai-enabled";
import { isLiveLane } from "@/lib/queue-ordering";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { compareQueuePriority } from "../../appointments/_hooks/use-appointments-list";
import {
  type AiQueueItem,
  useActiveDoctors,
  useAiQueueScores,
} from "../_hooks/use-reception-live";

export interface QueueColumnProps {
  rows: AppointmentRow[];
  className?: string;
}

const QUEUE_STATUSES = new Set(["BOOKED", "WAITING", "CONFIRMED"]);

type Band = AiQueueItem["score"]["band"];

const BAND_ACCENT: Record<Band, string> = {
  critical: "before:bg-destructive",
  high: "before:bg-warning",
  normal: "before:bg-primary/40",
  low: "before:bg-muted-foreground/30",
};

type QueueMode = "booked" | "walkin";

/**
 * Schedule lane: strictly by slot time = booking order. Bookings live on the
 * calendar axis — they never gain a position in the live queue, no matter
 * when they check in (two-lanes TZ I2).
 */
const bySlotTime = (a: AppointmentRow, b: AppointmentRow) =>
  new Date(a.date).getTime() - new Date(b.date).getTime();

/**
 * Live lane FIFO: urgency bump → arrival (queuedAt) → ticketSeq; creation
 * time only catches legacy rows where all three keys collide.
 */
const byArrival = (a: AppointmentRow, b: AppointmentRow) => {
  const c = compareQueuePriority(a, b);
  if (c !== 0) return c;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
};

export function QueueColumn({ rows, className }: QueueColumnProps) {
  const t = useTranslations("reception.queueColumn");
  const locale = useLocale();
  const aiScores = useAiQueueScores();
  const doctorsQuery = useActiveDoctors();

  /**
   * "Now" stamp for the wait-time fallback. Ticks every 30s so the orange
   * chip stays fresh without re-rendering on every animation frame, and so
   * we don't call the impure `Date.now()` directly during render.
   */
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const scoreMap = React.useMemo(() => {
    const m = new Map<string, AiQueueItem>();
    if (!AI_ENABLED) return m;
    for (const it of aiScores.data ?? []) m.set(it.appointmentId, it);
    return m;
  }, [aiScores.data]);

  const aiActive = AI_ENABLED && scoreMap.size > 0;

  /**
   * doctorId -> specialization (locale-aware). Used by the "Готовы к приёму"
   * subsection rows; `AppointmentDoctorShort` doesn't carry the specialization,
   * so we look it up from the active-doctors query.
   */
  const specByDoctor = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of doctorsQuery.data ?? []) {
      const spec = locale === "uz" ? d.specializationUz : d.specializationRu;
      if (spec) m.set(d.id, spec);
    }
    return m;
  }, [doctorsQuery.data, locale]);

  /**
   * Two lanes (docs/TZ-two-lanes.md), lane = f(channel), not status:
   *   - walk-ins -> "Живая очередь": the primary section, FIFO by arrival;
   *     their 1-2-3 is the position the receptionist announces.
   *   - bookings -> "Записанные": secondary, shown with their slot time,
   *     ordered by that time = booking order. They never enter the queue.
   * AI scores stay as row decoration (band accent + no-show pill), not the
   * sort key — order is deterministic so reception can trust 1-2-3.
   */
  const { booked, live, total } = React.useMemo(() => {
    const b: AppointmentRow[] = [];
    const l: AppointmentRow[] = [];
    for (const row of rows) {
      const queueField = row.queueStatus ?? row.status;
      if (!QUEUE_STATUSES.has(queueField)) continue;
      if (isLiveLane(row)) l.push(row);
      else b.push(row);
    }
    b.sort(bySlotTime);
    l.sort(byArrival);
    return { booked: b, live: l, total: b.length + l.length };
  }, [rows]);

  const empty = total === 0;

  return (
    <TooltipProvider>
      <section
        className={cn(
          "flex min-h-0 max-h-[min(640px,calc(100vh-14rem))] flex-col rounded-2xl border border-border bg-card",
          className,
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t("title")}
            {aiActive ? (
              <span
                title={t("aiTooltip")}
                className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-normal text-primary"
              >
                <SparklesIcon className="size-2.5" />
                AI
              </span>
            ) : null}
          </h3>
          <span className="flex shrink-0 items-center gap-1">
            <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
              {t("liveCount", { count: live.length })}
            </span>
            <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
              {t("bookedCount", { count: booked.length })}
            </span>
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {empty ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <>
              {live.length > 0 ? (
                <QueueSubsection
                  title={t("subsectionLive")}
                  count={live.length}
                >
                  {live.map((row, i) => (
                    <QueueItem
                      key={row.id}
                      index={i + 1}
                      row={row}
                      locale={locale}
                      ai={scoreMap.get(row.id)}
                      mode="walkin"
                      nowMs={nowMs}
                    />
                  ))}
                </QueueSubsection>
              ) : null}
              {booked.length > 0 ? (
                <QueueSubsection
                  title={t("subsectionBooked")}
                  count={booked.length}
                >
                  {booked.map((row, i) => (
                    <QueueItem
                      key={row.id}
                      index={i + 1}
                      row={row}
                      locale={locale}
                      ai={scoreMap.get(row.id)}
                      mode="booked"
                      nowMs={nowMs}
                      specialty={specByDoctor.get(row.doctor.id) ?? null}
                    />
                  ))}
                </QueueSubsection>
              ) : null}
            </>
          )}
        </div>
        <footer className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => {
              void aiScores.refetch();
            }}
            disabled={aiScores.isFetching}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCwIcon
              className={cn(
                "size-3",
                aiScores.isFetching && "animate-spin",
              )}
            />
            {t("refreshQueue")}
          </button>
        </footer>
      </section>
    </TooltipProvider>
  );
}

/**
 * Subsection wrapper — renders a sticky-ish header with title + count and
 * the rows below it. Caller is responsible for omitting the subsection when
 * empty so we never render a header with zero rows.
 */
function QueueSubsection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center justify-between bg-muted/30 px-4 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </span>
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
          {count}
        </span>
      </header>
      <ol className="divide-y divide-border">{children}</ol>
    </section>
  );
}

function QueueItem({
  index,
  row,
  locale,
  ai,
  mode,
  specialty,
  nowMs,
}: {
  index: number;
  row: AppointmentRow;
  locale: string;
  ai: AiQueueItem | undefined;
  mode: QueueMode;
  specialty?: string | null;
  nowMs?: number;
}) {
  const t = useTranslations("reception.queueColumn");
  const time = new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(row.date));

  const band = ai?.score.band;
  const noShowPct = ai ? Math.round(ai.noShowRisk * 100) : 0;
  const showRisk = ai && noShowPct >= 40;

  /**
   * Walk-ins always show wait-since-arrival; booked rows show it only once
   * they've checked in (queueStatus WAITING) and are sitting past their slot.
   * Prefer the AI-scored `waitMin` (server-computed); otherwise fall back to
   * "minutes past slot/arrival start", clamped at zero.
   */
  const arrived = (row.queueStatus ?? row.status) === "WAITING";
  const showWait = mode === "walkin" || arrived;
  let waitMin = 0;
  if (showWait) {
    if (ai?.waitMin != null) {
      waitMin = Math.max(0, Math.round(ai.waitMin));
    } else if (nowMs != null) {
      const elapsed = (nowMs - new Date(row.date).getTime()) / 60_000;
      waitMin = Math.max(0, Math.round(elapsed));
    }
  }

  return (
    <li>
      <Link
        href={`?ap=${row.id}`}
        scroll={false}
        className={cn(
          "relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/60",
          band &&
            "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full",
          band ? BAND_ACCENT[band] : "",
        )}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
          {index}
        </span>
        <AvatarWithStatus
          name={row.patient.fullName}
          src={row.patient.photoUrl}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-foreground">
              {row.patient.fullName}
            </span>
            {ai?.isVip ? (
              <span className="inline-flex shrink-0 items-center rounded bg-warning/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning-text">
                VIP
              </span>
            ) : null}
            {mode === "walkin" ? (
              <span className="inline-flex shrink-0 items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-text tabular-nums">
                {t("waitMin", { min: waitMin })}
              </span>
            ) : (
              <>
                {arrived ? (
                  <span className="inline-flex shrink-0 items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-text tabular-nums">
                    {t("waitMin", { min: waitMin })}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                  {time}
                </span>
              </>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {(locale === "uz"
                ? row.primaryService?.nameUz
                : row.primaryService?.nameRu) ??
                specialty ??
                (locale === "uz" ? row.doctor.nameUz : row.doctor.nameRu)}
            </span>
            {showRisk && ai ? <NoShowRiskPill ai={ai} /> : null}
            {mode === "walkin" ? (
              <span className="shrink-0 tabular-nums">{time}</span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * The no-show percentage chip plus a factor-breakdown tooltip. Wrapped in a
 * <span> with `e.preventDefault()` on the trigger so hovering/clicking the
 * pill doesn't navigate via the parent <Link>.
 */
function NoShowRiskPill({ ai }: { ai: AiQueueItem }) {
  const t = useTranslations("noShowFactors");
  const tConf = useTranslations("noShowFactors.confidence");
  const noShowPct = Math.round(ai.noShowRisk * 100);
  const f = ai.noShowFactors;

  // Format a single factor as "+N%" (or "—" when zero).
  const pct = (n: number) => {
    if (!n) return "—";
    const rounded = Math.round(n * 100);
    return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
  };
  // historyRisk is a *base* probability, not a bump — show it as a flat %.
  const flatPct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            // Prevent the parent <Link> from navigating when the user taps
            // the pill on touch devices (where hover isn't available).
            e.preventDefault();
            e.stopPropagation();
          }}
          className="shrink-0 cursor-help text-[10px] font-medium text-warning"
        >
          · {noShowPct}%
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px]">
        <div className="flex flex-col gap-1 text-[11px]">
          <FactorRow label={t("historyRisk")} value={flatPct(f.historyRisk)} />
          <FactorRow
            label={t("firstVisitBump")}
            value={pct(f.firstVisitBump)}
          />
          <FactorRow
            label={t("unconfirmedBump")}
            value={pct(f.unconfirmedBump)}
          />
          <FactorRow label={t("farFutureBump")} value={pct(f.farFutureBump)} />
          {typeof f.dayOfWeekBump === "number" ? (
            <FactorRow
              label={t("dayOfWeekBump")}
              value={pct(f.dayOfWeekBump)}
            />
          ) : null}
          <div className="mt-1 border-t border-border pt-1 text-[10px] text-muted-foreground">
            {t("confidenceLabel")}: {tConf(ai.noShowConfidence)}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function FactorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
