"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
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

type QueueMode = "waiting" | "ready";

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
    for (const it of aiScores.data ?? []) m.set(it.appointmentId, it);
    return m;
  }, [aiScores.data]);

  const aiActive = scoreMap.size > 0;

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

  const sortFn = React.useCallback(
    (a: AppointmentRow, b: AppointmentRow) => {
      if (aiActive) {
        const sa = scoreMap.get(a.id)?.score.score ?? -1;
        const sb = scoreMap.get(b.id)?.score.score ?? -1;
        if (sa !== sb) return sb - sa;
      }
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    },
    [aiActive, scoreMap],
  );

  /**
   * Bucket split by `queueStatus` (the canonical queue lifecycle field):
   *   - WAITING               -> "Ожидают вызова" (already arrived)
   *   - BOOKED / CONFIRMED    -> "Готовы к приёму" (scheduled, not arrived)
   *
   * AI score sort is applied WITHIN each bucket, not across them.
   */
  const { waiting, ready, total } = React.useMemo(() => {
    const w: AppointmentRow[] = [];
    const r: AppointmentRow[] = [];
    for (const row of rows) {
      const queueField = row.queueStatus ?? row.status;
      if (!QUEUE_STATUSES.has(queueField)) continue;
      if (queueField === "WAITING") w.push(row);
      else r.push(row);
    }
    w.sort(sortFn);
    r.sort(sortFn);
    return { waiting: w, ready: r, total: w.length + r.length };
  }, [rows, sortFn]);

  const empty = total === 0;

  return (
    <TooltipProvider>
      <section
        className={cn(
          "flex min-h-0 flex-col rounded-2xl border border-border bg-card",
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
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {total}
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {empty ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <>
              {waiting.length > 0 ? (
                <QueueSubsection
                  title={t("subsectionWaiting")}
                  count={waiting.length}
                >
                  {waiting.map((row, i) => (
                    <QueueItem
                      key={row.id}
                      index={i + 1}
                      row={row}
                      locale={locale}
                      ai={scoreMap.get(row.id)}
                      mode="waiting"
                      nowMs={nowMs}
                    />
                  ))}
                </QueueSubsection>
              ) : null}
              {ready.length > 0 ? (
                <QueueSubsection
                  title={t("subsectionReady")}
                  count={ready.length}
                >
                  {ready.map((row, i) => (
                    <QueueItem
                      key={row.id}
                      index={i + 1}
                      row={row}
                      locale={locale}
                      ai={scoreMap.get(row.id)}
                      mode="ready"
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
   * Wait minutes for the orange chip on "Ожидают вызова" rows.
   * Prefer the AI-scored `waitMin` (computed server-side relative to call/
   * arrival time); otherwise fall back to "minutes past slot start", clamped
   * at zero so we never render a negative wait.
   */
  let waitMin = 0;
  if (mode === "waiting") {
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
          "relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60",
          band &&
            "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full",
          band ? BAND_ACCENT[band] : "",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
          {index}
        </span>
        <AvatarWithStatus
          name={row.patient.fullName}
          src={row.patient.photoUrl}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {row.patient.fullName}
            </span>
            {ai?.isVip ? (
              <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                VIP
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            <span className="truncate">
              {locale === "uz"
                ? row.primaryService?.nameUz ?? row.doctor.nameUz
                : row.primaryService?.nameRu ?? row.doctor.nameRu}
            </span>
            {showRisk && ai ? <NoShowRiskPill ai={ai} /> : null}
          </div>
        </div>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {time}
        </span>
        {mode === "waiting" ? (
          <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 tabular-nums dark:bg-amber-500/15 dark:text-amber-300">
            {t("waitMin", { min: waitMin })}
          </span>
        ) : specialty ? (
          <span className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {specialty}
          </span>
        ) : null}
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
