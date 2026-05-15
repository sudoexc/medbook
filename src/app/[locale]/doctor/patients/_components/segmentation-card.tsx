"use client";

import { cn } from "@/lib/utils";

import {
  useDoctorPatientSegments,
  type Segment,
  type SegmentKey,
} from "../_hooks/use-doctor-patient-segments";

const COLOR: Record<SegmentKey, string> = {
  active: "var(--success)",
  watch: "var(--info)",
  dormant: "var(--muted-foreground)",
  new: "var(--primary)",
  returned: "var(--warning)",
};

const DOT: Record<SegmentKey, string> = {
  active: "bg-success",
  watch: "bg-info",
  dormant: "bg-muted-foreground",
  new: "bg-primary",
  returned: "bg-warning",
};

const SIZE = 96;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Header() {
  return (
    <div className="mb-3 text-[15px] font-semibold text-foreground">
      Сегментация базы
    </div>
  );
}

export function SegmentationCard() {
  const { data, isLoading, isError } = useDoctorPatientSegments();

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="flex items-center gap-4">
          <div
            className="shrink-0 animate-pulse rounded-full bg-muted"
            style={{ width: SIZE, height: SIZE }}
          />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-muted" />
                <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
                <span className="h-3 w-12 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">Всего пациентов</span>
          <span className="h-3 w-8 animate-pulse rounded bg-muted" />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="py-6 text-center text-xs text-destructive">
          Не удалось загрузить сегментацию.
        </div>
      </section>
    );
  }

  if (data.total === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <Header />
        <div className="flex items-center gap-4">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0 -rotate-90"
            aria-hidden
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--border)"
              strokeWidth={STROKE}
            />
          </svg>
          <p className="text-xs text-muted-foreground">
            Пока нет пациентов с завершёнными визитами. Когда появятся, тут
            раскроется разбивка по сегментам.
          </p>
        </div>
      </section>
    );
  }

  // Build arc geometry. Each arc starts where the previous one left off so
  // they ring around the donut without overlap.
  let offset = 0;
  const arcs = data.segments
    .filter((s) => s.count > 0)
    .map((s: Segment) => {
      const len = (s.percent / 100) * CIRCUMFERENCE;
      const arc = { key: s.key, length: len, offset };
      offset += len;
      return arc;
    });

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <Header />

      <div className="flex items-center gap-4">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="shrink-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE}
          />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={COLOR[a.key]}
              strokeWidth={STROKE}
              strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </svg>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {data.segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", DOT[s.key])}
              />
              <span className="flex-1 text-foreground">{s.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {s.count} ({s.percent}%)
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">Всего пациентов</span>
        <span className="font-semibold text-foreground tabular-nums">
          {data.total.toLocaleString("ru-RU").replace(",", " ")}
        </span>
      </div>
    </section>
  );
}
