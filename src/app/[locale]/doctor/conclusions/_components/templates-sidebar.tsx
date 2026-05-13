"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_DRAFTS,
  MOCK_TEMPLATES_ALL,
  MOCK_TEMPLATES_FREQUENT,
  type Template,
} from "../_mocks";

export function TemplatesSidebar() {
  const activeTab = "templates";

  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card px-3 py-3">
        {/* Tabs */}
        <div className="flex items-center border-b border-border">
          <TabButton active={activeTab === "templates"}>Шаблоны</TabButton>
          <TabButton active={false}>Черновики</TabButton>
        </div>

        {/* Search */}
        <label className="relative mt-3 block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Поиск шаблонов..."
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </label>

        {/* Filters */}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Все
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            <StarIcon className="size-3.5 text-muted-foreground" />
            Избранные
          </button>
        </div>

        {/* Frequent group */}
        <GroupHeader label="Часто используемые" />
        <ul className="space-y-0.5">
          {MOCK_TEMPLATES_FREQUENT.map((t) => (
            <TemplateRow key={t.id} t={t} />
          ))}
        </ul>

        {/* All templates group */}
        <GroupHeader label="Все шаблоны" />
        <ul className="space-y-0.5">
          {MOCK_TEMPLATES_ALL.map((t) => (
            <TemplateRow key={t.id} t={t} />
          ))}
        </ul>

        <button
          type="button"
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-border bg-background py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Управление шаблонами
        </button>
      </section>

      <section className="rounded-2xl border border-border bg-card px-3 py-3">
        <GroupHeader label={`Черновики (${MOCK_DRAFTS.length})`} first />
        <ul className="space-y-1">
          {MOCK_DRAFTS.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {d.title}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {d.when}
                  </div>
                </div>
                <span className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  Черновик
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 inline-flex w-full items-center justify-center text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Показать все черновики
        </button>
      </section>
    </aside>
  );
}

function TabButton({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex-1 py-2.5 text-sm transition-colors",
        active
          ? "font-semibold text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {active ? (
        <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
      ) : null}
    </button>
  );
}

function GroupHeader({ label, first }: { label: string; first?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        first ? "mb-2" : "mb-2 mt-4",
      )}
    >
      <span>{label}</span>
      <ChevronRightIcon className="size-3.5" />
    </div>
  );
}

function TemplateRow({ t }: { t: Template }) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
          t.selected
            ? "bg-primary/10 font-semibold text-primary"
            : "text-foreground hover:bg-muted/50",
        )}
      >
        <FileTextIcon
          className={cn(
            "size-4 shrink-0",
            t.selected ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="flex-1 truncate">{t.label}</span>
        {t.starred ? (
          <StarIcon className="size-3.5 shrink-0 fill-warning text-warning" />
        ) : null}
      </button>
    </li>
  );
}
