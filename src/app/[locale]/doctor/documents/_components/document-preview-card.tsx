"use client";

import {
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GitCompareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PenLineIcon,
  SettingsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { MOCK_PREVIEW } from "../_mocks";

const ACTIONS = [
  { key: "open", Icon: ExternalLinkIcon, label: "Открыть" },
  { key: "download", Icon: DownloadIcon, label: "Скачать" },
  { key: "sign", Icon: PenLineIcon, label: "Подписать" },
  { key: "attach", Icon: PaperclipIcon, label: "Прикрепить к приёму" },
  { key: "compare", Icon: GitCompareIcon, label: "Сравнить" },
] as const;

export function DocumentPreviewCard() {
  const p = MOCK_PREVIEW;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-foreground">
          {p.filename}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Настройки"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Свернуть"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-0.5">
        <div className="text-sm font-semibold text-foreground">
          {p.patient.fullName}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {p.patient.age} лет ({p.patient.birthDate})
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          ID: {p.patient.id}
        </div>
      </div>

      <div className="mt-3 space-y-0.5 text-xs">
        <div>
          <span className="text-muted-foreground">Дата исследования: </span>
          <span className="font-medium text-foreground tabular-nums">
            {p.studyDate}
          </span>
        </div>
        <div className="text-foreground">{p.studyType}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {p.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
          >
            {t}
          </span>
        ))}
      </div>

      {/* Preview area */}
      <div className="relative mt-4 overflow-hidden rounded-xl bg-foreground/95">
        <div className="grid aspect-[4/3] grid-cols-3 gap-1 p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-md bg-gradient-to-br from-slate-700 to-slate-900"
              aria-hidden
            />
          ))}
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            type="button"
            aria-label="Уменьшить"
            className="flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground transition-colors hover:bg-background"
          >
            <ZoomOutIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Увеличить"
            className="flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground transition-colors hover:bg-background"
          >
            <ZoomInIcon className="size-3.5" />
          </button>
        </div>
        <div className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground tabular-nums">
          Стр. {p.page.current} из {p.page.total}
          <ChevronRightIcon className="size-3" />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 grid grid-cols-6 gap-1">
        {ACTIONS.map(({ key, Icon, label }) => (
          <button
            key={key}
            type="button"
            className="flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[10px] leading-tight text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon className="size-4 shrink-0" />
            <span className="w-full break-words hyphens-auto">{label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Ещё"
          className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </div>
    </section>
  );
}
