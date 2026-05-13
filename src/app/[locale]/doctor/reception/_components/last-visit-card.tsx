"use client";

import { ArrowRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_LAST_VISIT } from "../_mocks";

const TONE: Record<"success" | "warning", string> = {
  success: "bg-success",
  warning: "bg-warning",
};

export function LastVisitCard() {
  const v = MOCK_LAST_VISIT;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="text-[15px] font-semibold text-foreground">
          Последний визит
        </div>
        <span className="inline-flex items-center rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
          {v.type}
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="text-sm font-semibold text-foreground tabular-nums">
          {v.date}, {v.timeRange}
        </div>
        <Row label="Врач" value={v.doctorName} />
        <Row
          label="Статус"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", TONE[v.status.tone])} />
              {v.status.label}
            </span>
          }
        />
      </div>

      <button
        type="button"
        className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        Открыть последний визит
        <ArrowRightIcon className="size-4" />
      </button>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
