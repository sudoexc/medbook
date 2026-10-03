"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ListTodoIcon, PlusIcon, RotateCcwIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DEV_TASK_BOARD_COLUMNS,
  groupDevTasks,
  parseDevTaskRef,
  type DevTaskCardDto,
  type DevTaskStatus,
} from "@/lib/dev-tasks";

import { DevTaskCard } from "./dev-task-card";
import { DevTaskDrawer } from "./dev-task-drawer";
import { NewDevTaskDialog } from "./new-dev-task-dialog";
import { useDevTaskBoard } from "./use-dev-tasks";

/** Count chip colour per column: new work stands out, the rest stays calm. */
const COUNT_TONE: Record<DevTaskStatus, string> = {
  NEW: "bg-violet/15 text-[color:var(--violet)]",
  IN_PROGRESS: "bg-info/15 text-[color:var(--info)]",
  DONE: "bg-success/15 text-[color:var(--success)]",
  CANCELLED: "bg-muted text-muted-foreground",
};

/**
 * «Задачи» — the board the owner files requests on and the developer works
 * from. Shared by /crm/tasks and /doctor/tasks.
 *
 * Desktop: three columns «Новые / В работе / Готово». Phone: the columns
 * become tabs and «+ Задача» sits at the bottom, under the thumb. The open
 * task lives in the URL (`?task=12`), so a link sent in Telegram opens it
 * and the phone's back button closes it.
 */
export function DevTaskBoard() {
  const t = useTranslations("devTasks");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const [includeCancelled, setIncludeCancelled] = React.useState(false);
  const [tab, setTab] = React.useState<DevTaskStatus>("NEW");
  const [createOpen, setCreateOpen] = React.useState(false);
  // True when this page pushed the `?task=` entry, so closing can go back
  // instead of leaving a duplicate history step behind.
  const pushedTask = React.useRef(false);

  const rawTask = searchParams?.get("task") ?? null;
  const openRef = React.useMemo(() => {
    const ref = parseDevTaskRef(rawTask);
    return ref ? ("number" in ref ? String(ref.number) : ref.id) : null;
  }, [rawTask]);

  const q = useDevTaskBoard(includeCancelled);
  const columns = React.useMemo(() => groupDevTasks(q.data?.rows ?? []), [q.data]);
  const counts = q.data?.counts;
  const forbidden = q.error?.status === 403;
  const visibleColumns: DevTaskStatus[] = includeCancelled
    ? [...DEV_TASK_BOARD_COLUMNS, "CANCELLED"]
    : [...DEV_TASK_BOARD_COLUMNS];
  const activeTab = visibleColumns.includes(tab) ? tab : "NEW";
  const boardEmpty =
    !!counts && counts.NEW + counts.IN_PROGRESS + counts.DONE + counts.CANCELLED === 0;

  const openTask = (task: DevTaskCardDto) => {
    pushedTask.current = true;
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.set("task", String(task.number));
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const closeTask = () => {
    if (pushedTask.current) {
      pushedTask.current = false;
      router.back();
      return;
    }
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.delete("task");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const column = (status: DevTaskStatus) => {
    const rows = columns[status];
    return rows.length === 0 ? (
      <p className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        {t(`empty.${status}`)}
      </p>
    ) : (
      <ul className="flex flex-col gap-2">
        {rows.map((task) => (
          <li key={task.id}>
            <DevTaskCard task={task} onOpen={openTask} />
          </li>
        ))}
      </ul>
    );
  };

  return (
    <PageContainer className="pb-28 md:pb-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <button
              type="button"
              aria-pressed={includeCancelled}
              onClick={() => setIncludeCancelled((v) => !v)}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors md:h-8",
                includeCancelled
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {t("showCancelled")}
              {counts ? (
                <span className="rounded-md bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {counts.CANCELLED}
                </span>
              ) : null}
            </button>
            <Button
              onClick={() => setCreateOpen(true)}
              aria-label={t("addAria")}
              className="hidden md:inline-flex"
            >
              <PlusIcon />
              {t("add")}
            </Button>
          </>
        }
      />

      {forbidden ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("forbidden")}
        </p>
      ) : q.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm text-destructive">{t("loadError")}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            <RotateCcwIcon />
            {t("retry")}
          </Button>
        </div>
      ) : q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {DEV_TASK_BOARD_COLUMNS.map((s) => (
            <div key={s} className="flex flex-col gap-2">
              <Skeleton className="h-6 w-28 rounded-md" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : boardEmpty && !includeCancelled ? (
        <EmptyState
          icon={<ListTodoIcon />}
          title={t("empty.NEW")}
          description={t("emptyBoard")}
          action={
            <Button onClick={() => setCreateOpen(true)} className="h-11 md:h-8">
              <PlusIcon />
              {t("add")}
            </Button>
          }
        />
      ) : (
        <>
          {/* Phone: one column at a time, picked by big tabs. */}
          <div className="md:hidden">
            <div
              role="tablist"
              aria-label={t("title")}
              className={cn(
                "sticky top-0 z-10 -mx-4 mb-3 grid gap-1 bg-surface px-4 py-2 sm:-mx-6 sm:px-6",
                visibleColumns.length === 4 ? "grid-cols-4" : "grid-cols-3",
              )}
            >
              {visibleColumns.map((s) => {
                const active = activeTab === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(s)}
                    className={cn(
                      "flex h-12 flex-col items-center justify-center rounded-lg border px-1 text-xs font-medium leading-tight transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <span className="truncate">{t(`columns.${s}`)}</span>
                    <span className="text-[11px] font-semibold tabular-nums">{counts?.[s] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div role="tabpanel">{column(activeTab)}</div>
          </div>

          {/* Desktop: the columns side by side. */}
          <div
            className={cn(
              "hidden items-start gap-4 md:grid",
              visibleColumns.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3",
            )}
          >
            {visibleColumns.map((s) => (
              <section
                key={s}
                aria-label={t(`columns.${s}`)}
                className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/30 p-2"
              >
                <header className="flex items-center justify-between px-1 py-1">
                  <h3 className="text-sm font-semibold text-foreground">{t(`columns.${s}`)}</h3>
                  <span
                    className={cn(
                      "rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
                      COUNT_TONE[s],
                    )}
                  >
                    {counts?.[s] ?? 0}
                  </span>
                </header>
                {column(s)}
              </section>
            ))}
          </div>
        </>
      )}

      {/* Phone: the main action within thumb reach, above the home bar. */}
      {!forbidden ? (
        <Button
          onClick={() => setCreateOpen(true)}
          aria-label={t("addAria")}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 h-14 rounded-full px-5 text-base shadow-lg md:hidden"
        >
          <PlusIcon className="size-5" />
          {t("add")}
        </Button>
      ) : null}

      <NewDevTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DevTaskDrawer taskRef={openRef} onClose={closeTask} />
    </PageContainer>
  );
}
