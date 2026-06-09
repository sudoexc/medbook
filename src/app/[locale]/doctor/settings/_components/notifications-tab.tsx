"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BellIcon,
  MailIcon,
  MessageCircleIcon,
  SendIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";

import {
  useDoctorNotificationPrefs,
  usePatchDoctorNotificationPrefs,
  type DoctorNotificationPref,
} from "../_hooks/use-doctor-notification-prefs";

type Channel = "inApp" | "email" | "telegram";
type EventKey =
  | "appointmentCreated"
  | "messageNew"
  | "labResultReceived"
  | "reminderDue";

const EVENTS: Array<{ key: EventKey }> = [
  { key: "appointmentCreated" },
  { key: "messageNew" },
  { key: "labResultReceived" },
  { key: "reminderDue" },
];

const CHANNELS: Array<{
  key: Channel;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "inApp", icon: BellIcon },
  { key: "email", icon: MailIcon },
  { key: "telegram", icon: SendIcon },
];

function fieldName(event: EventKey, channel: Channel): keyof DoctorNotificationPref {
  return `${event}_${channel}` as keyof DoctorNotificationPref;
}

export function NotificationsTab() {
  const t = useTranslations("doctor.settings");
  const prefs = useDoctorNotificationPrefs();
  const patch = usePatchDoctorNotificationPrefs();

  if (prefs.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <Skeleton className="mb-1 h-4 w-40 rounded-md" />
        <Skeleton className="mb-5 h-3 w-3/4 rounded-md" />

        <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] items-center gap-3 border-b border-border pb-2">
          <Skeleton className="h-3 w-16 rounded-md" />
          {CHANNELS.map((c) => (
            <Skeleton key={c.key} className="mx-auto h-3 w-12 rounded-md" />
          ))}
        </div>

        <ul className="divide-y divide-border">
          {EVENTS.map((e) => (
            <li
              key={e.key}
              className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] items-center gap-3 py-3"
            >
              <div className="min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-3 w-56 rounded-md" />
              </div>
              {CHANNELS.map((c) => (
                <div key={c.key} className="flex justify-center">
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </li>
          ))}
        </ul>

        <Skeleton className="mt-4 h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (prefs.isError || !prefs.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive">
        {t("notifications.loadError")}
        <button
          type="button"
          onClick={() => prefs.refetch()}
          className="ml-1 underline"
        >
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  const data = prefs.data;
  const onToggle = (event: EventKey, channel: Channel, next: boolean) => {
    const field = fieldName(event, channel);
    patch.mutate(
      { [field]: next } as Partial<DoctorNotificationPref>,
      {
        onError: () => toast.error(t("actions.saveError")),
      },
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 text-sm font-semibold text-foreground">
        {t("notifications.heading")}
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        {t("notifications.subheading")}
      </p>

      <div
        className={cn(
          "grid items-center gap-3 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
          "grid-cols-[minmax(0,1fr)_80px_80px_80px]",
        )}
      >
        <div>{t("notifications.eventColumn")}</div>
        {CHANNELS.map((c) => (
          <div key={c.key} className="flex flex-col items-center gap-1">
            <c.icon className="size-3.5" />
            {t(`notifications.channels.${c.key}`)}
          </div>
        ))}
      </div>

      <ul className="divide-y divide-border">
        {EVENTS.map((e) => (
          <li
            key={e.key}
            className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] items-center gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t(`notifications.events.${e.key}.label`)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(`notifications.events.${e.key}.description`)}
              </div>
            </div>
            {CHANNELS.map((c) => {
              const checked = Boolean(data[fieldName(e.key, c.key)]);
              return (
                <div key={c.key} className="flex justify-center">
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) => onToggle(e.key, c.key, v)}
                    aria-label={`${t(`notifications.events.${e.key}.label`)} → ${t(`notifications.channels.${c.key}`)}`}
                  />
                </div>
              );
            })}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <MessageCircleIcon className="size-4 shrink-0" />
        <span>
          {t.rich("notifications.telegramHint", {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </span>
      </div>
    </div>
  );
}
