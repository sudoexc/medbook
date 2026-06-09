"use client";

import * as React from "react";
import {
  CheckIcon,
  FlaskConicalIcon,
  Loader2Icon,
  UserIcon,
} from "lucide-react";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  flattenLabs,
  useDoctorPatientLabs,
  type DoctorPatientLabRow,
} from "../../_hooks/use-doctor-patient-labs";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const FLAG_TONE: Record<NonNullable<DoctorPatientLabRow["flag"]>, string> = {
  NORMAL: "bg-success/15 text-success",
  HIGH: "bg-warning/15 text-warning",
  LOW: "bg-warning/15 text-warning",
  CRITICAL: "bg-destructive/15 text-destructive",
};

const FLAG_LABEL_KEY: Record<NonNullable<DoctorPatientLabRow["flag"]>, string> =
  {
    NORMAL: "labs.flag.normal",
    HIGH: "labs.flag.high",
    LOW: "labs.flag.low",
    CRITICAL: "labs.flag.critical",
  };

async function markReviewed(id: string): Promise<void> {
  await fetch(`/api/crm/doctors/me/labs/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "REVIEWED" }),
  });
}

export function LabsSection({ patientId }: { patientId: string }) {
  const t = useTranslations("doctor.patients");
  const list = useDoctorPatientLabs(patientId);
  const rows = flattenLabs(list.data);
  // Track in-flight "REVIEWED" requests so the row dims while waiting for
  // the SSE-triggered refetch to flip status.
  const [reviewing, setReviewing] = React.useState<Set<string>>(new Set());

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          list.hasNextPage &&
          !list.isFetchingNextPage
        ) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {t("labs.loading")}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
        {t("labs.loadError")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("labs.empty")}
      </div>
    );
  }

  const handleReview = async (id: string) => {
    setReviewing((prev) => new Set(prev).add(id));
    try {
      await markReviewed(id);
    } finally {
      // The SSE refetch will swap the row's status — we drop the local mark
      // either way so a failure doesn't leave the button permanently dimmed.
      setReviewing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const isReviewed = r.status === "REVIEWED";
          const isOptimistic = reviewing.has(r.id);
          return (
            <li
              key={r.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors",
                isReviewed ? "opacity-70" : "hover:bg-muted",
              )}
            >
              <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
                <FlaskConicalIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {r.testName}
                  </span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {r.value}
                    {r.unit ? ` ${r.unit}` : ""}
                  </span>
                  {r.refRange ? (
                    <span className="text-xs text-muted-foreground">
                      {t("labs.ref", { range: r.refRange })}
                    </span>
                  ) : null}
                  {r.flag ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        FLAG_TONE[r.flag],
                      )}
                    >
                      {t(FLAG_LABEL_KEY[r.flag])}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{ruDate(r.receivedAt)}</span>
                  {!r.orderedByMe ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                      <UserIcon className="size-3" />
                      {t("labs.fromColleague")}
                    </span>
                  ) : null}
                  {isReviewed && r.reviewedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                      <CheckIcon className="size-3" />
                      {t("labs.reviewedOn", { date: ruDate(r.reviewedAt) })}
                    </span>
                  ) : null}
                </div>
                {r.notes ? (
                  <div className="mt-1 text-xs text-foreground">{r.notes}</div>
                ) : null}
              </div>
              {!isReviewed && r.orderedByMe ? (
                <button
                  type="button"
                  onClick={() => handleReview(r.id)}
                  disabled={isOptimistic}
                  className={cn(
                    "motion-press inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted",
                    isOptimistic && "cursor-wait opacity-60",
                  )}
                >
                  <CheckIcon className="size-3.5" />
                  {t("labs.markReviewed")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} />
      {list.isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {t("loadingMore")}
        </div>
      )}
    </section>
  );
}
