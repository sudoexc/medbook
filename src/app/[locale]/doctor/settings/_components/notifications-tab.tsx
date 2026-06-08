"use client";

import * as React from "react";
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

const EVENTS: Array<{ key: EventKey; label: string; description: string }> = [
  {
    key: "appointmentCreated",
    label: "Новый приём",
    description: "Когда регистратура добавила вам приём на сегодня или позже",
  },
  {
    key: "messageNew",
    label: "Новое сообщение",
    description: "Сообщения от пациентов и коллег в чатах",
  },
  {
    key: "labResultReceived",
    label: "Результат анализа",
    description: "Когда поступил результат назначенного исследования",
  },
  {
    key: "reminderDue",
    label: "Напоминание",
    description: "Когда наступило время для созданного вами напоминания",
  },
];

const CHANNELS: Array<{
  key: Channel;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "inApp", label: "В системе", icon: BellIcon },
  { key: "email", label: "Email", icon: MailIcon },
  { key: "telegram", label: "Telegram", icon: SendIcon },
];

function fieldName(event: EventKey, channel: Channel): keyof DoctorNotificationPref {
  return `${event}_${channel}` as keyof DoctorNotificationPref;
}

export function NotificationsTab() {
  const prefs = useDoctorNotificationPrefs();
  const patch = usePatchDoctorNotificationPrefs();

  if (prefs.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (prefs.isError || !prefs.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive">
        Не удалось загрузить настройки.
        <button
          type="button"
          onClick={() => prefs.refetch()}
          className="ml-1 underline"
        >
          Повторить
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
        onError: () => toast.error("Не удалось сохранить"),
      },
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 text-sm font-semibold text-foreground">
        Каналы и события
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Выберите, через какие каналы получать уведомления для каждого типа
        событий. Изменения сохраняются автоматически.
      </p>

      <div
        className={cn(
          "grid items-center gap-3 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
          "grid-cols-[minmax(0,1fr)_80px_80px_80px]",
        )}
      >
        <div>Событие</div>
        {CHANNELS.map((c) => (
          <div key={c.key} className="flex flex-col items-center gap-1">
            <c.icon className="size-3.5" />
            {c.label}
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
                {e.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {e.description}
              </div>
            </div>
            {CHANNELS.map((c) => {
              const checked = Boolean(data[fieldName(e.key, c.key)]);
              return (
                <div key={c.key} className="flex justify-center">
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) => onToggle(e.key, c.key, v)}
                    aria-label={`${e.label} → ${c.label}`}
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
          Канал <strong>Telegram</strong> работает, только если вы привязали
          бота к своему аккаунту в разделе «Безопасность».
        </span>
      </div>
    </div>
  );
}
