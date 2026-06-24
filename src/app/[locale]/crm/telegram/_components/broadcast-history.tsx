"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  RepeatIcon,
  XCircleIcon,
  CalendarClockIcon,
  Loader2Icon,
  CheckCircle2Icon,
  BanIcon,
  SendHorizonalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DateText } from "@/components/atoms/date-text";
import { EmptyState } from "@/components/atoms/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  useBroadcastHistory,
  useCancelBroadcast,
  type BroadcastHistoryItem,
  type BroadcastDerivedStatus,
  type BroadcastSegment,
} from "../_hooks/use-broadcast";

const STATUS_BADGE: Record<BroadcastDerivedStatus, string> = {
  scheduled: "border-info/30 bg-info/10 text-[color:var(--info)]",
  sending:
    "border-warning/30 bg-warning/10 text-[color:var(--warning-foreground)]",
  done: "border-success/30 bg-success/10 text-[color:var(--success)]",
  cancelled: "border-border/60 bg-muted text-muted-foreground",
};

const STATUS_ICON: Record<
  BroadcastDerivedStatus,
  { Icon: typeof CalendarClockIcon; spin?: boolean }
> = {
  scheduled: { Icon: CalendarClockIcon },
  sending: { Icon: Loader2Icon, spin: true },
  done: { Icon: CheckCircle2Icon },
  cancelled: { Icon: BanIcon },
};

function audienceLabel(
  segment: BroadcastSegment,
  tb: ReturnType<typeof useTranslations>,
): string {
  switch (segment.kind) {
    case "all":
      return tb("audience.kind.all");
    case "segment":
      return (
        segment.segments.map((s) => tb(`audience.segment.${s}`)).join(", ") ||
        tb("audience.kind.segment")
      );
    case "tag":
      return segment.tags.join(", ") || tb("audience.kind.tag");
  }
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className={cn("text-[13px] font-semibold tabular-nums", tone)}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function BroadcastRow({
  item,
  onRepeat,
}: {
  item: BroadcastHistoryItem;
  onRepeat: (item: BroadcastHistoryItem) => void;
}) {
  const tb = useTranslations("tgInbox.broadcast");
  const t = useTranslations("tgInbox.broadcastHistory");
  const cancel = useCancelBroadcast();
  const [confirming, setConfirming] = React.useState(false);

  const f = item.funnel;
  const sent = f.sent + f.delivered + f.read;
  const delivered = f.delivered + f.read;
  const { Icon, spin } = STATUS_ICON[item.status];

  const onCancel = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    cancel.mutate(item.id, {
      onSuccess: () => toast.success(t("toast.cancelled")),
      onError: () => toast.error(t("toast.cancelError")),
    });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                STATUS_BADGE[item.status],
              )}
            >
              <Icon className={cn("size-3", spin && "animate-spin")} aria-hidden />
              {t(`status.${item.status}`)}
            </span>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {item.name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{audienceLabel(item.segment, tb)}</span>
            <span aria-hidden>·</span>
            {item.status === "scheduled" && item.scheduledFor ? (
              <span className="inline-flex items-center gap-1 text-[color:var(--info)]">
                <CalendarClockIcon className="size-3" aria-hidden />
                <DateText date={item.scheduledFor} style="dayMonthTime" />
              </span>
            ) : (
              <DateText date={item.createdAt} style="dayMonthTime" />
            )}
            {item.createdByName ? (
              <>
                <span aria-hidden>·</span>
                <span>{item.createdByName}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRepeat(item)}
          >
            <RepeatIcon aria-hidden />
            {t("repeat")}
          </Button>
          {item.status === "scheduled" ? (
            <Button
              size="sm"
              variant={confirming ? "destructive" : "outline"}
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : (
                <XCircleIcon aria-hidden />
              )}
              {confirming ? t("cancelConfirm") : t("cancel")}
            </Button>
          ) : null}
        </div>
      </div>

      {item.body ? (
        <p className="mt-2 line-clamp-2 whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px] text-muted-foreground">
          {item.body}
        </p>
      ) : null}

      {item.status === "scheduled" ? (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SendHorizonalIcon className="size-3.5" aria-hidden />
          {t("recipients", { count: f.total })}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Stat value={f.total} label={t("funnel.total")} />
          <Stat value={sent} label={t("funnel.sent")} />
          <Stat
            value={delivered}
            label={t("funnel.delivered")}
            tone="text-[color:var(--success)]"
          />
          <Stat value={f.read} label={t("funnel.read")} />
          {f.failed > 0 ? (
            <Stat
              value={f.failed}
              label={t("funnel.failed")}
              tone="text-destructive"
            />
          ) : null}
          {f.blocked > 0 ? (
            <Stat
              value={f.blocked}
              label={t("funnel.blocked")}
              tone="text-destructive"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export function BroadcastHistory({
  open,
  onOpenChange,
  onRepeat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRepeat: (item: BroadcastHistoryItem) => void;
}) {
  const t = useTranslations("tgInbox.broadcastHistory");
  const query = useBroadcastHistory(open);
  const items = query.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" aria-hidden />
          </div>
        ) : items.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={<SendHorizonalIcon />}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <BroadcastRow key={item.id} item={item} onRepeat={onRepeat} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
