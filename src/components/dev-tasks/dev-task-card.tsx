"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, MessageSquareIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDevTaskNumber, type DevTaskCardDto } from "@/lib/dev-tasks";

import { DevTaskPriorityChip, useDevTaskAgeLabel } from "./dev-task-bits";

/**
 * One task on the board: number, title, priority, author, age and the
 * first screenshot. The whole card is the button that opens the task, a
 * thumb-sized target on a phone.
 */
export function DevTaskCard({
  task,
  onOpen,
}: {
  task: DevTaskCardDto;
  onOpen: (task: DevTaskCardDto) => void;
}) {
  const t = useTranslations("devTasks");
  const ageLabel = useDevTaskAgeLabel();
  const [thumbBroken, setThumbBroken] = React.useState(false);

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      aria-label={t("openTask", { number: formatDevTaskNumber(task.number) })}
      className={cn(
        "motion-press flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        task.priority === "URGENT" && task.status !== "DONE" && task.status !== "CANCELLED"
          ? "border-destructive/40"
          : "border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
            {formatDevTaskNumber(task.number)}
          </span>
          <DevTaskPriorityChip priority={task.priority} quiet />
        </div>
        <p className="mt-1 line-clamp-3 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {task.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="max-w-[12rem] truncate">{task.createdBy.name}</span>
          <span aria-hidden>·</span>
          <time dateTime={task.createdAt}>{ageLabel(task.createdAt)}</time>
          {task.commentCount > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t("commentsCount", { count: task.commentCount })}
            >
              <MessageSquareIcon className="size-3.5" aria-hidden />
              <span className="tabular-nums">{task.commentCount}</span>
              <span className="sr-only">{t("commentsCount", { count: task.commentCount })}</span>
            </span>
          ) : null}
          {task.attachmentCount > 1 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t("screenshotsCount", { count: task.attachmentCount })}
            >
              <ImageIcon className="size-3.5" aria-hidden />
              <span className="tabular-nums">{task.attachmentCount}</span>
              <span className="sr-only">
                {t("screenshotsCount", { count: task.attachmentCount })}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {task.thumbUrl ? (
        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
          {thumbBroken ? (
            <ImageIcon className="absolute inset-0 m-auto size-5 text-muted-foreground" aria-hidden />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a session-gated stream, not a static asset next/image could optimise
            <img
              src={task.thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setThumbBroken(true)}
              className="size-full object-cover object-top"
            />
          )}
        </span>
      ) : null}
    </button>
  );
}
