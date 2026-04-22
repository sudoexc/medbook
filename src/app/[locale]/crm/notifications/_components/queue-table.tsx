"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/atoms/empty-state";

import { useQueue, useRetrySend } from "../_hooks/use-queue";
import type { QueueRow } from "../_hooks/use-queue";
import type { QueueStatus, QueueTab } from "../_hooks/types";
import { STATUS_FOR_TAB } from "../_hooks/types";

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

function formatDT(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function QueueTable() {
  const t = useTranslations("notifications");
  const [tab, setTab] = React.useState<QueueTab>("all");
  const status = STATUS_FOR_TAB[tab];
  const query = useQueue(status);
  const retryMut = useRetrySend();

  const rows: QueueRow[] = query.data?.rows ?? [];

  const onRetry = async (id: string) => {
    try {
      await retryMut.mutateAsync(id);
      toast.success(t("queue.retried"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 text-sm">
          {(["all", "pending", "sent", "failed"] as QueueTab[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={
                tab === v
                  ? "rounded-md bg-card px-3 py-1 font-medium text-foreground shadow-sm"
                  : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {t(`queue.tabs.${v}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value="all" onValueChange={() => undefined} disabled>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t("queue.filter.channel")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("queue.filter.allChannels")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon className="size-3.5" />
            {t("queue.refresh")}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("queue.empty.title")}
          description={t("queue.empty.description")}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-medium">{t("queue.col.scheduled")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.recipient")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.template")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.channel")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.status")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.retries")}</th>
                <th className="px-2 py-2 font-medium">{t("queue.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatDT(r.scheduledFor)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="truncate font-medium">
                      {r.patient?.fullName ?? r.recipient}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.recipient}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="truncate">
                      {r.template ? r.template.nameRu : t("queue.manual")}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant="outline">{r.channel}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {t(`queue.status.${r.status}`)}
                    </Badge>
                    {r.failedReason ? (
                      <div
                        className="mt-0.5 truncate text-[10px] text-destructive"
                        title={r.failedReason}
                      >
                        {r.failedReason}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-xs">{r.retryCount}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {r.status === "FAILED" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onRetry(r.id)}
                          disabled={retryMut.isPending}
                        >
                          <RotateCcwIcon className="size-3" />
                          {t("queue.retry")}
                        </Button>
                      ) : null}
                      {r.status === "QUEUED" ? (
                        <Button size="xs" variant="ghost" disabled>
                          <XIcon className="size-3" />
                          {t("queue.cancel")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
