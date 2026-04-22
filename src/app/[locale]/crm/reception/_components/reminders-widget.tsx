"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { BellIcon, CheckIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import type { UpcomingReminder } from "../_hooks/use-reception-live";

export interface RemindersWidgetProps {
  reminders: UpcomingReminder[];
  className?: string;
}

/**
 * Right-rail "Напоминания" — patients whose appointment starts within 2
 * hours without an SMS yet (TZ §6.1.5).
 *
 * Uses the existing `/api/crm/communications/sms` endpoint (log-only
 * dispatch — the real sender lands with Phase 3a `notifications-engineer`).
 *
 * TODO(api-builder): dedicated `/api/crm/communications/sms/bulk` so we can
 * fan out in one network hit instead of N-sequential.
 * TODO(notifications-engineer): add a `hasReminder` boolean to the
 * appointment row so this widget stops guessing from the timeline.
 */
export function RemindersWidget({ reminders, className }: RemindersWidgetProps) {
  const t = useTranslations("reception.reminders");
  const locale = useLocale();
  const qc = useQueryClient();
  const [sentIds, setSentIds] = React.useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const onSend = async (reminder: UpcomingReminder) => {
    const { appointment } = reminder;
    if (pendingId || sentIds.has(appointment.id)) return;
    setPendingId(appointment.id);
    try {
      const smsBody = t("smsTemplate", {
        name: appointment.patient.fullName,
        time: fmtTime(new Date(appointment.date), locale),
      });
      const res = await fetch(`/api/crm/communications/sms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: appointment.patient.id,
          phone: appointment.patient.phone,
          body: smsBody,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSentIds((prev) => {
        const next = new Set(prev);
        next.add(appointment.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["reception"] });
      toast.success(t("sent"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  const visible = reminders.slice(0, 5);

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <BellIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {t("subtitle")}
        </span>
      </header>

      <div className="p-3">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <CheckIcon
              className="size-5 text-[color:var(--success)]"
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((reminder) => {
              const isSent = sentIds.has(reminder.appointment.id);
              const time = fmtTime(
                new Date(reminder.appointment.date),
                locale,
              );
              return (
                <li
                  key={reminder.appointment.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                >
                  <AvatarWithStatus
                    name={reminder.appointment.patient.fullName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {reminder.appointment.patient.fullName}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {time}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {reminder.minutesUntil <= 0
                        ? t("soon")
                        : t("inMinutes", { min: reminder.minutesUntil })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isSent ? "ghost" : "outline"}
                    disabled={isSent || pendingId === reminder.appointment.id}
                    onClick={() => onSend(reminder)}
                  >
                    {isSent ? t("sent") : t("sendNow")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function fmtTime(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
}
