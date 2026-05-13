"use client";

import { cn } from "@/lib/utils";
import {
  MOCK_SEGMENTS,
  MOCK_SEGMENTS_TOTAL,
  type SegmentTone,
} from "../_mocks";

const COLOR: Record<SegmentTone, string> = {
  active: "var(--success)",
  watch: "var(--info)",
  dormant: "var(--muted-foreground)",
  new: "var(--primary)",
  returned: "var(--warning)",
};

const DOT: Record<SegmentTone, string> = {
  active: "bg-success",
  watch: "bg-info",
  dormant: "bg-muted-foreground",
  new: "bg-primary",
  returned: "bg-warning",
};

export function SegmentationCard() {
  const size = 96;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = MOCK_SEGMENTS.map((s) => {
    const len = (s.percent / 100) * circumference;
    const arc = {
      key: s.key,
      length: len,
      offset,
    };
    offset += len;
    return arc;
  });

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Сегментация базы
      </div>

      <div className="flex items-center gap-4">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="shrink-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={COLOR[a.key]}
              strokeWidth={stroke}
              strokeDasharray={`${a.length} ${circumference - a.length}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </svg>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {MOCK_SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span className={cn("size-1.5 shrink-0 rounded-full", DOT[s.key])} />
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
          {MOCK_SEGMENTS_TOTAL.toLocaleString("ru-RU").replace(",", " ")}
        </span>
      </div>
    </section>
  );
}
