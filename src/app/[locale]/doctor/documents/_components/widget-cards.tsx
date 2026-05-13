"use client";

import { FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_DRAFTS,
  MOCK_RECENT_DOCS,
  MOCK_STORAGE,
} from "../_mocks";

const TONE_DOT: Record<"primary" | "success" | "warning", string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
};

export function WidgetCards() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
      <RecentCard />
      <DraftsCard />
      <StorageCard />
    </div>
  );
}

function RecentCard() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Недавние документы
      </div>
      <ul className="flex-1 space-y-3">
        {MOCK_RECENT_DOCS.map((d) => (
          <li key={d.id} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
              <FileTextIcon className="size-4 text-destructive" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {d.filename}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {d.patient} · {d.when}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 text-sm font-semibold text-primary transition-colors hover:underline"
      >
        Открыть недавние
      </button>
    </section>
  );
}

function DraftsCard() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Мои черновики
      </div>
      <ul className="flex-1 space-y-3">
        {MOCK_DRAFTS.map((d) => (
          <li key={d.id} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10">
              <FileTextIcon className="size-4 text-info" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {d.filename}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Черновик · {d.when}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 text-sm font-semibold text-primary transition-colors hover:underline"
      >
        Перейти к черновикам
      </button>
    </section>
  );
}

function StorageCard() {
  const s = MOCK_STORAGE;
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Хранилище
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground tabular-nums">
          {s.usedGb} ГБ из {s.totalGb} ГБ
        </span>
        <span className="text-muted-foreground tabular-nums">{s.percent}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${s.percent}%` }}
        />
      </div>

      <div className="mt-4 text-xs font-semibold text-muted-foreground">
        Типы файлов
      </div>
      <ul className="mt-2 flex-1 space-y-1.5">
        {s.breakdown.map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-xs">
            <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[b.tone])} />
            <span className="flex-1 text-foreground">{b.label}</span>
            <span className="text-muted-foreground tabular-nums">{b.value}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="mt-4 text-sm font-semibold text-primary transition-colors hover:underline"
      >
        Управление хранилищем
      </button>
    </section>
  );
}
