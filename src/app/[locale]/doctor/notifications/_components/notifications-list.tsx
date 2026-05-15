"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BellIcon, BellOffIcon, Loader2Icon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useDoctorReminders,
  type Reminder,
} from "../_hooks/use-doctor-reminders";
import { ReminderRow } from "./reminder-row";
import { CreateReminderDialog } from "./create-reminder-dialog";

type TabKey = "active" | "done" | "archive";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "active", label: "Актуальные" },
  { key: "done", label: "Выполненные" },
  { key: "archive", label: "Архив" },
];

function tabFromParam(raw: string | null): TabKey {
  if (raw === "done" || raw === "archive") return raw;
  return "active";
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function bucketRows(rows: Reminder[], cutoffMs: number) {
  const active: Reminder[] = [];
  const done: Reminder[] = [];
  const archive: Reminder[] = [];

  for (const r of rows) {
    if (r.status === "PENDING" || r.status === "SNOOZED") {
      active.push(r);
      continue;
    }
    // 30-day cutoff: filter out very old completed/dismissed rows so the
    // archive/done tabs don't grow unbounded. Server still keeps them for
    // audit, just hidden from the doctor's day-to-day view.
    const ts = new Date(r.completedAt ?? r.createdAt).getTime();
    if (Date.now() - ts > cutoffMs) continue;
    if (r.status === "DONE") done.push(r);
    else if (r.status === "DISMISSED") archive.push(r);
  }

  // PENDING/SNOOZED: chronological by remindAt (next-up first).
  active.sort(
    (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime(),
  );
  // DONE/DISMISSED: most recent action first.
  const recentDesc = (a: Reminder, b: Reminder) =>
    new Date(b.completedAt ?? b.createdAt).getTime() -
    new Date(a.completedAt ?? a.createdAt).getTime();
  done.sort(recentDesc);
  archive.sort(recentDesc);

  return { active, done, archive };
}

/**
 * Re-renders every minute so relative-time labels («через 5 мин», «просрочено
 * 30 мин») stay accurate without per-row timers.
 */
function useNowTick(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function NotificationsList() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useNowTick();

  const [tab, setTab] = React.useState<TabKey>(() =>
    tabFromParam(searchParams.get("tab")),
  );
  const [createOpen, setCreateOpen] = React.useState(false);

  const setTabAndUrl = React.useCallback(
    (next: TabKey) => {
      setTab(next);
      const p = new URLSearchParams(searchParams.toString());
      if (next === "active") p.delete("tab");
      else p.set("tab", next);
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const list = useDoctorReminders();
  const buckets = React.useMemo(
    () => bucketRows(list.data ?? [], THIRTY_DAYS_MS),
    [list.data],
  );
  const rows =
    tab === "active"
      ? buckets.active
      : tab === "done"
        ? buckets.done
        : buckets.archive;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-border bg-card p-0.5">
          {TABS.map((t) => {
            const count =
              t.key === "active"
                ? buckets.active.length
                : t.key === "done"
                  ? buckets.done.length
                  : buckets.archive.length;
            return (
              <TabBtn
                key={t.key}
                active={tab === t.key}
                onClick={() => setTabAndUrl(t.key)}
                count={count}
              >
                {t.label}
              </TabBtn>
            );
          })}
        </div>

        <Button type="button" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-1.5 size-4" />
          Создать напоминание
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        {list.isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex items-start gap-4 px-4 py-3">
                <Skeleton className="size-9 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-7 w-20" />
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <div className="px-4 py-12 text-center text-sm text-destructive">
            Не удалось загрузить напоминания.
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => list.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState tab={tab} onCreate={() => setCreateOpen(true)} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <ReminderRow key={r.id} reminder={r} locale={locale} now={now} />
            ))}
          </ul>
        )}
        {list.isFetching && !list.isLoading ? (
          <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Обновляем…
          </div>
        ) : null}
      </section>

      <CreateReminderDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span
        className={cn(
          "rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums",
          active
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyState({
  tab,
  onCreate,
}: {
  tab: TabKey;
  onCreate: () => void;
}) {
  if (tab === "active") {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BellIcon className="size-5" />
        </span>
        <div className="text-sm font-medium text-foreground">
          Нет актуальных напоминаний
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          Создайте заметку для себя — позвонить, проверить результат,
          перезаказать анализы.
        </p>
        <Button type="button" size="sm" onClick={onCreate}>
          <PlusIcon className="mr-1.5 size-4" />
          Создать напоминание
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <BellOffIcon className="size-5" />
      </span>
      <div className="text-sm text-muted-foreground">
        {tab === "done"
          ? "За последние 30 дней ничего не отмечено как выполненное."
          : "За последние 30 дней архив пуст."}
      </div>
    </div>
  );
}
