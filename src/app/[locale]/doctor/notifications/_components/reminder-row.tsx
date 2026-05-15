"use client";

import * as React from "react";
import Link from "next/link";
import {
  BellIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  MoreVerticalIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";

import {
  usePatchReminder,
  useDeleteReminder,
  type Reminder,
} from "../_hooks/use-doctor-reminders";

function tomorrowAtNineIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function plusHoursIso(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

/**
 * "через 2 ч", "просрочено 30 мин", "сегодня в 14:00", "завтра в 09:00",
 * "12 мая 14:00". Always relative to wall-clock `now`. Re-rendered every
 * minute by the page's `useNowTick` so labels don't go stale.
 */
function formatRelative(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  const diffMin = Math.round((t - now.getTime()) / 60_000);

  if (diffMin >= -1 && diffMin <= 1) return "сейчас";

  if (diffMin > 0 && diffMin < 60) return `через ${diffMin} мин`;
  if (diffMin < 0 && diffMin > -60) {
    return `просрочено ${Math.abs(diffMin)} мин`;
  }
  if (diffMin > 0 && diffMin < 24 * 60) {
    const h = Math.round(diffMin / 60);
    return `через ${h} ч`;
  }
  if (diffMin < 0 && diffMin > -24 * 60) {
    const h = Math.round(Math.abs(diffMin) / 60);
    return `просрочено ${h} ч`;
  }

  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `сегодня в ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) {
    return `завтра в ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<
  Reminder["status"],
  { label: string; tone: string }
> = {
  PENDING: {
    label: "Актуально",
    tone: "bg-primary/10 text-primary",
  },
  SNOOZED: {
    label: "Отложено",
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  DONE: {
    label: "Выполнено",
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  DISMISSED: {
    label: "В архиве",
    tone: "bg-muted text-muted-foreground",
  },
};

export function ReminderRow({
  reminder,
  locale,
  now,
}: {
  reminder: Reminder;
  locale: string;
  now: Date;
}) {
  const patch = usePatchReminder();
  const remove = useDeleteReminder();

  const isPending = reminder.status === "PENDING" || reminder.status === "SNOOZED";
  const isOverdue = isPending && new Date(reminder.remindAt).getTime() < now.getTime();
  const badge = STATUS_BADGE[reminder.status];

  const markDone = async () => {
    try {
      await patch.mutateAsync({ id: reminder.id, status: "DONE" });
      toast.success("Готово");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const reopen = async () => {
    try {
      await patch.mutateAsync({ id: reminder.id, status: "PENDING" });
      toast.success("Возвращено в актуальные");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const snooze = async (preset: "1h" | "4h" | "tomorrow", label: string) => {
    const remindAt =
      preset === "1h"
        ? plusHoursIso(1)
        : preset === "4h"
          ? plusHoursIso(4)
          : tomorrowAtNineIso();
    try {
      await patch.mutateAsync({
        id: reminder.id,
        status: "SNOOZED",
        remindAt,
      });
      toast.success(`Отложено: ${label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const dismiss = async () => {
    if (!window.confirm("Удалить напоминание?")) return;
    try {
      await remove.mutateAsync(reminder.id);
      toast.success("Удалено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const busy = patch.isPending || remove.isPending;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <span
        className={cn(
          "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
          isOverdue
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary",
        )}
      >
        <BellIcon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">
            {reminder.title}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              badge.tone,
            )}
          >
            {badge.label}
          </span>
        </div>
        {reminder.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {reminder.body}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1 tabular-nums",
              isOverdue && "text-destructive",
            )}
          >
            <ClockIcon className="size-3" />
            {formatRelative(reminder.remindAt, now)}
          </span>
          {reminder.patientFullName && reminder.patientId ? (
            <Link
              href={`/${locale}/doctor/patients/${reminder.patientId}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground hover:bg-muted/70"
            >
              <UserIcon className="size-3" />
              <span className="truncate max-w-[160px]">
                {reminder.patientFullName}
              </span>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isPending ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={markDone}
          >
            {patch.isPending ? (
              <Loader2Icon className="mr-1 size-3.5 animate-spin" />
            ) : (
              <CheckCircle2Icon className="mr-1 size-3.5" />
            )}
            Готово
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={reopen}
          >
            <RotateCcwIcon className="mr-1 size-3.5" />
            Вернуть
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Действия"
              disabled={busy}
            >
              <MoreVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {isPending ? (
              <>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Отложить
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void snooze("1h", "1 час")}>
                  На 1 час
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void snooze("4h", "4 часа")}>
                  На 4 часа
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void snooze("tomorrow", "завтра 9:00")}
                >
                  До завтра 9:00
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {reminder.patientId ? (
              <DropdownMenuItem asChild>
                <Link href={`/${locale}/doctor/patients/${reminder.patientId}`}>
                  Открыть пациента
                </Link>
              </DropdownMenuItem>
            ) : null}
            {reminder.status !== "DISMISSED" ? (
              <DropdownMenuItem
                onClick={dismiss}
                className="text-destructive focus:text-destructive"
              >
                <Trash2Icon className="mr-2 size-3.5" />
                Удалить
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
