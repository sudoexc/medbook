"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  SettingsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_DOC_PAGINATION,
  MOCK_DOC_ROWS,
  type DocRowStatus,
} from "../_mocks";

const STATUS_LABEL: Record<DocRowStatus, string> = {
  ready: "Готов",
  signed: "Подписан",
  in_progress: "В работе",
};

const STATUS_DOT: Record<DocRowStatus, string> = {
  ready: "bg-success",
  signed: "bg-info",
  in_progress: "bg-warning",
};

const STATUS_TEXT: Record<DocRowStatus, string> = {
  ready: "text-success",
  signed: "text-info",
  in_progress: "text-warning",
};

const GRID =
  "grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1.2fr)_120px_120px_90px_minmax(0,1.2fr)_110px_36px] gap-3";

export function DocumentsTable() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div
        className={cn(
          GRID,
          "items-center border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div>
          <Checkbox />
        </div>
        <div>Название</div>
        <div>Пациент</div>
        <div>Тип документа</div>
        <div>Дата</div>
        <div>Размер</div>
        <div>Теги</div>
        <div>Статус</div>
        <div className="flex justify-end">
          <SettingsIcon className="size-4" />
        </div>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-border">
        {MOCK_DOC_ROWS.map((r) => (
          <li
            key={r.id}
            className={cn(
              GRID,
              "items-center px-5 py-3.5 transition-colors hover:bg-muted/30",
              r.selected && "bg-primary/5",
            )}
          >
            <div>
              <Checkbox checked={r.selected} />
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <FileTextIcon className="size-4 text-destructive" />
              </span>
              <span className="truncate text-sm font-medium text-foreground">
                {r.filename}
              </span>
            </div>

            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {r.patient.name}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {r.patient.age} лет
              </div>
            </div>

            <div className="text-sm text-foreground">{r.type}</div>

            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground tabular-nums">
                {r.date}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {r.time}
              </div>
            </div>

            <div className="text-sm text-foreground tabular-nums">{r.size}</div>

            <div className="flex min-w-0 flex-wrap gap-1">
              {r.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[r.status])} />
              <span className={cn("text-xs font-medium", STATUS_TEXT[r.status])}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                aria-label="Ещё действия"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontalIcon className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Pagination */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <div className="text-xs text-muted-foreground tabular-nums">
          Показано {MOCK_DOC_PAGINATION.rangeFrom}–{MOCK_DOC_PAGINATION.rangeTo} из{" "}
          {MOCK_DOC_PAGINATION.total.toLocaleString("ru-RU").replace(",", " ")}
        </div>

        <nav className="flex items-center gap-1">
          <PageNavBtn aria="Предыдущая">
            <ChevronLeftIcon className="size-4" />
          </PageNavBtn>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                n === MOCK_DOC_PAGINATION.currentPage
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {n}
            </button>
          ))}
          <span className="flex size-8 items-center justify-center text-sm text-muted-foreground">
            …
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg text-sm text-foreground transition-colors hover:bg-muted tabular-nums"
          >
            {MOCK_DOC_PAGINATION.totalPages}
          </button>
          <PageNavBtn aria="Следующая">
            <ChevronRightIcon className="size-4" />
          </PageNavBtn>
        </nav>

        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted"
        >
          <span className="tabular-nums">{MOCK_DOC_PAGINATION.pageSize}</span> на странице
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
      </footer>
    </section>
  );
}

function PageNavBtn({
  aria,
  children,
}: {
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Checkbox({ checked }: { checked?: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked ? "true" : "false"}
      className={cn(
        "flex size-4 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
      )}
    >
      {checked ? (
        <svg viewBox="0 0 16 16" fill="none" className="size-3">
          <path
            d="M3 8l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
