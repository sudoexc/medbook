"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  BellIcon,
  CheckIcon,
  ExternalLinkIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";

import type { QueueRow, StatsResponse } from "../_hooks/use-queue";
import { useRetrySend } from "../_hooks/use-queue";
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

export function NotificationsDetailsRail({
  row,
  stats,
}: {
  row: QueueRow | null;
  stats: StatsResponse | undefined;
}) {
  const t = useTranslations("notifications.details");
  const locale = useLocale();
  const retry = useRetrySend();

  if (!row) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={<BellIcon />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      </div>
    );
  }

  const Icon = CHANNEL_ICON[row.channel];
  const fmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const onRetry = async () => {
    try {
      await retry.mutateAsync(row.id);
      toast.success(t("toasts.retried"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onStub = () => toast.info(t("toasts.stubAction"));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* Patient header */}
      <section className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-start gap-3">
          <AvatarWithStatus
            name={row.patient?.fullName ?? row.recipient}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {row.patient?.fullName ?? row.recipient}
            </div>
            {row.patient?.phone ? (
              <div className="mt-0.5 text-xs text-muted-foreground">
                <PhoneText phone={row.patient.phone} />
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {row.recipient}
              </div>
            )}
          </div>
          {row.patient ? (
            <Link
              href={`/${locale}/crm/patients/${row.patient.id}`}
              className={cn(
                buttonVariants({ size: "sm", variant: "ghost" }),
                "shrink-0",
              )}
              aria-label={t("openPatient")}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </section>

      {/* Channel + status + preview */}
      <section className="rounded-xl border border-border bg-background p-3">
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-primary" aria-hidden />
            <span className="text-sm font-semibold">{row.channel}</span>
          </div>
          <Badge variant={STATUS_VARIANT[row.status]}>
            {t(`status.${row.status}`)}
          </Badge>
        </header>
        {row.template ? (
          <div className="mb-2 text-[11px] text-muted-foreground">
            {t("templateLabel")}:{" "}
            <span className="text-foreground">
              {locale === "uz" ? row.template.nameUz : row.template.nameRu}
            </span>
          </div>
        ) : null}
        <div className="rounded-md bg-muted/40 p-3 text-[12px] leading-snug text-foreground">
          {row.body}
        </div>
        {row.failedReason ? (
          <p className="mt-2 rounded-md bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            {row.failedReason}
          </p>
        ) : null}
      </section>

      {/* Actions */}
      <section className="rounded-xl border border-border bg-background p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("actions.title")}
        </h3>
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={row.status !== "FAILED" || retry.isPending}
          >
            <RotateCcwIcon className="size-3.5" />
            {t("actions.retry")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onStub}
            disabled={row.status !== "QUEUED"}
          >
            <XIcon className="size-3.5" />
            {t("actions.cancel")}
          </Button>
          <Button size="sm" variant="outline" onClick={onStub}>
            <SendIcon className="size-3.5" />
            {t("actions.resend")}
          </Button>
        </div>
      </section>

      {/* History timeline */}
      <section className="rounded-xl border border-border bg-background p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("history.title")}
        </h3>
        <ol className="space-y-2">
          <TimelineRow
            label={t("history.scheduled")}
            at={row.scheduledFor}
            fmt={fmt}
            active
          />
          <TimelineRow
            label={t("history.sent")}
            at={row.sentAt}
            fmt={fmt}
            active={Boolean(row.sentAt)}
          />
          <TimelineRow
            label={t("history.delivered")}
            at={row.deliveredAt}
            fmt={fmt}
            active={Boolean(row.deliveredAt)}
          />
          <TimelineRow
            label={t("history.read")}
            at={row.readAt}
            fmt={fmt}
            active={Boolean(row.readAt)}
          />
        </ol>
        {row.retryCount > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("history.retriesLabel", { count: row.retryCount })}
          </p>
        ) : null}
      </section>

      {/* Context stats (30d) */}
      {stats ? (
        <section className="rounded-xl border border-border bg-background p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("context.title")}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <MiniRow label={t("context.total30d")} value={stats.last30d.total} />
            <MiniRow
              label={t("context.delivered30d")}
              value={stats.last30d.delivered}
            />
            <MiniRow
              label={t("context.failed30d")}
              value={stats.last30d.failed}
              tone="danger"
            />
            <MiniRow
              label={t("context.activeTemplates")}
              value={stats.activeTemplates}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TimelineRow({
  label,
  at,
  fmt,
  active,
}: {
  label: string;
  at: string | null;
  fmt: Intl.DateTimeFormat;
  active: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {active ? <CheckIcon className="size-2.5" /> : null}
      </span>
      <div className="flex min-w-0 flex-1 justify-between gap-2 text-[12px]">
        <span className={active ? "text-foreground" : "text-muted-foreground"}>
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {at ? fmt.format(new Date(at)) : "—"}
        </span>
      </div>
    </li>
  );
}

function MiniRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-semibold tabular-nums",
          tone === "danger" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
