"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquareIcon, StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { EmptyState } from "@/components/atoms/empty-state";
import { DateText } from "@/components/atoms/date-text";
import { CountUp } from "@/components/atoms/count-up";

import { useDoctorReviews } from "../_hooks/use-doctor-reviews";

export interface DoctorReviewsProps {
  doctorId: string;
  className?: string;
}

/**
 * Doctor reviews tab.
 *
 * Reads from PatientReview rows (NPS 1..10 captured via the TG mini-app /
 * bot). Renders an avg-score header with score distribution histogram and
 * the latest reviews. Low-NPS rows (<7) get a subtle red accent so the
 * admin's eye lands on them first.
 */
export function DoctorReviews({ doctorId, className }: DoctorReviewsProps) {
  const t = useTranslations("crmDoctors.reviews");
  const tag = intlLocale(useLocale());
  const query = useDoctorReviews(doctorId, 20);

  const summary = query.data?.summary;
  const rows = query.data?.rows ?? [];

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        "motion-fade-in",
        className,
      )}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : query.error ? (
        <EmptyState
          icon={<MessageSquareIcon />}
          title={t("loadError")}
          description={query.error.message}
        />
      ) : summary && summary.count > 0 ? (
        <>
          <SummaryCard summary={summary} t={t} tag={tag} />
          <ul className="motion-stagger mt-4 space-y-2">
            {rows.map((r) => (
              <ReviewItem key={r.id} row={r} t={t} />
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<MessageSquareIcon />}
          title={t("empty")}
          description={
            <span className="inline-flex items-center gap-1">
              <StarIcon className="size-3.5" />
              {t("emptyHint")}
            </span>
          }
        />
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────

type ReviewT = ReturnType<typeof useTranslations<"crmDoctors.reviews">>;

function SummaryCard({
  summary,
  t,
  tag,
}: {
  summary: {
    count: number;
    avgScore: number | null;
    distribution: Record<string, number>;
  };
  t: ReviewT;
  tag: string;
}) {
  const avg = summary.avgScore ?? 0;
  const tone = avg >= 9 ? "good" : avg >= 7 ? "ok" : "bad";
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "ok"
      ? "text-amber-600"
      : "text-rose-600";

  // Compress the 1..10 distribution into 5 buckets for a tidy histogram:
  // low (1-2), low-mid (3-4), mid (5-6), high-mid (7-8), high (9-10).
  const buckets = React.useMemo(
    () => [
      { label: "1–2", value: (summary.distribution["1"] ?? 0) + (summary.distribution["2"] ?? 0), tone: "bad" as const },
      { label: "3–4", value: (summary.distribution["3"] ?? 0) + (summary.distribution["4"] ?? 0), tone: "bad" as const },
      { label: "5–6", value: (summary.distribution["5"] ?? 0) + (summary.distribution["6"] ?? 0), tone: "mid" as const },
      { label: "7–8", value: (summary.distribution["7"] ?? 0) + (summary.distribution["8"] ?? 0), tone: "ok" as const },
      { label: "9–10", value: (summary.distribution["9"] ?? 0) + (summary.distribution["10"] ?? 0), tone: "good" as const },
    ],
    [summary.distribution],
  );
  const max = Math.max(1, ...buckets.map((b) => b.value));

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background/60 p-3 sm:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-start sm:min-w-[7.5rem]">
        <div className={cn("flex items-baseline gap-1.5", toneClass)}>
          <StarIcon className="size-4 fill-current" />
          {summary.avgScore == null ? (
            <span className="text-2xl font-semibold tabular-nums">—</span>
          ) : (
            <CountUp
              to={summary.avgScore}
              durationMs={520}
              format={(v) => v.toFixed(1)}
              className="text-2xl font-semibold tabular-nums"
            />
          )}
          <span className="text-xs text-muted-foreground">/ 10</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          <CountUp
            to={summary.count}
            durationMs={520}
            format={(v) => Math.round(v).toLocaleString(tag)}
            className="tabular-nums"
          />{" "}
          {t("countLabel")}
        </div>
      </div>
      <div className="flex items-end gap-2">
        {buckets.map((b) => {
          const h = Math.max(4, Math.round((b.value / max) * 56));
          const color =
            b.tone === "good"
              ? "bg-emerald-500/80"
              : b.tone === "ok"
              ? "bg-emerald-400/70"
              : b.tone === "mid"
              ? "bg-amber-400/70"
              : "bg-rose-500/70";
          return (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={cn("w-full rounded-sm transition-[height] duration-[var(--motion-dur-slow)] ease-[var(--motion-ease-emphasized)]", color)}
                style={{ height: `${h}px` }}
                aria-hidden
              />
              <div className="flex items-baseline gap-1 text-[10px] tabular-nums text-muted-foreground">
                <span>{b.label}</span>
                <span className="font-medium text-foreground/80">{b.value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewItem({ row, t }: { row: { id: string; score: number; comment: string | null; respondedAt: string; patientName: string | null; source: string }; t: ReviewT }) {
  const tone = row.score >= 9 ? "good" : row.score >= 7 ? "ok" : "bad";
  const accent =
    tone === "good"
      ? "border-l-emerald-500/60"
      : tone === "ok"
      ? "border-l-amber-500/60"
      : "border-l-rose-500/70";
  const scoreColor =
    tone === "good"
      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
      : tone === "ok"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
      : "text-rose-600 bg-rose-50 dark:bg-rose-950/30";

  return (
    <li
      className={cn(
        "rounded-md border border-border border-l-2 bg-background/60 p-3",
        "motion-hover-lift",
        accent,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
              scoreColor,
            )}
          >
            {row.score}
          </span>
          <span className="text-sm font-medium text-foreground">
            {row.patientName ?? t("anonymousAuthor")}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          <DateText date={row.respondedAt} style="short" />
          <span className="mx-1.5 text-muted-foreground/60">·</span>
          <span className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {row.source}
          </span>
        </div>
      </div>
      {row.comment ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">
          {row.comment}
        </p>
      ) : (
        <p className="mt-1.5 text-xs italic text-muted-foreground">
          {t("noComment")}
        </p>
      )}
    </li>
  );
}
