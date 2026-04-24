"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  BellIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { EmptyState } from "@/components/atoms/empty-state";

import type { QueueRow } from "../_hooks/use-queue";
import type { QueueStatus, TemplateChannel } from "../_hooks/types";

const CHANNEL_ICON: Record<TemplateChannel, LucideIcon> = {
  SMS: MessageSquareIcon,
  TG: SendIcon,
  EMAIL: MailIcon,
  CALL: PhoneIcon,
  VISIT: BellIcon,
};

const STATUS_VARIANT: Record<
  QueueStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  QUEUED: "warning",
  SENT: "info",
  DELIVERED: "success",
  READ: "success",
  FAILED: "destructive",
  CANCELLED: "muted",
};

export function NotificationsActivityList({
  rows,
  isLoading,
  selectedId,
  onSelect,
}: {
  rows: QueueRow[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("notifications.activity");
  const locale = useLocale();

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          icon={<BellIcon />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      </div>
    );
  }

  const fmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => {
        const Icon = CHANNEL_ICON[row.channel];
        const isActive = row.id === selectedId;
        const when = row.sentAt ?? row.scheduledFor;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              className={cn(
                "flex w-full items-start gap-3 px-3 py-2.5 text-left transition",
                isActive ? "bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <AvatarWithStatus
                name={row.patient?.fullName ?? row.recipient}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {row.patient?.fullName ?? row.recipient}
                  </span>
                  <Badge
                    variant={STATUS_VARIANT[row.status]}
                    className="shrink-0 text-[10px]"
                  >
                    {t(`status.${row.status}`)}
                  </Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Icon className="size-3" aria-hidden />
                  <span>{row.channel}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{fmt.format(new Date(when))}</span>
                  {row.template ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {locale === "uz"
                          ? row.template.nameUz
                          : row.template.nameRu}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
                  {row.body}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
