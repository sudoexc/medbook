"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Loader2Icon,
  UsersIcon,
  BanIcon,
  UserXIcon,
  ShieldOffIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { MessageBubble } from "./message-bubble";
import type { InboxMessage } from "../_hooks/types";
import type { AudiencePreview } from "../_hooks/use-broadcast";
import { fillPlaceholders, firstNameOf } from "../_lib/placeholders";

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: "primary" | "muted" | "warning" | "destructive";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border px-2.5 py-2",
        tone === "primary" && "border-primary/30 bg-primary/5",
        tone === "muted" && "border-border/60 bg-muted/30",
        tone === "warning" && "border-warning/30 bg-warning/5",
        tone === "destructive" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] leading-none">{label}</span>
      </div>
      <span className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export function BroadcastPreview({
  body,
  preview,
  isLoading,
  resolvable,
}: {
  body: string;
  preview: AudiencePreview | undefined;
  isLoading: boolean;
  resolvable: boolean;
}) {
  const t = useTranslations("tgInbox.broadcast");

  const sampleName = preview?.sample[0]?.fullName ?? t("preview.sampleName");
  const filled = fillPlaceholders(body, {
    firstName: firstNameOf(sampleName) || t("preview.sampleName"),
    name: sampleName,
    clinic: t("preview.clinicName"),
    phone: t("preview.clinicPhone"),
    address: t("preview.clinicAddress"),
  });

  const previewMessage: InboxMessage = {
    id: "broadcast-preview",
    conversationId: "broadcast-preview",
    direction: "OUT",
    body: filled.trim().length > 0 ? filled : t("preview.empty"),
    attachments: null,
    buttons: null,
    senderId: "broadcast-op",
    sender: null,
    status: "SENT",
    externalId: null,
    replyToId: null,
    createdAt: new Date().toISOString(),
  };

  const breakdown = preview?.channelBreakdown;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("preview.label")}
      </div>

      {/* Reachability stats */}
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard
          icon={<UsersIcon className="size-3.5" aria-hidden />}
          value={preview?.eligible ?? 0}
          label={t("preview.willReceive")}
          tone="primary"
        />
        <StatCard
          icon={<BanIcon className="size-3.5" aria-hidden />}
          value={breakdown?.noChannel ?? 0}
          label={t("preview.noChannel")}
          tone="muted"
        />
        <StatCard
          icon={<UserXIcon className="size-3.5" aria-hidden />}
          value={breakdown?.optedOut ?? 0}
          label={t("preview.optedOut")}
          tone="warning"
        />
        <StatCard
          icon={<ShieldOffIcon className="size-3.5" aria-hidden />}
          value={breakdown?.blocked ?? 0}
          label={t("preview.blocked")}
          tone="destructive"
        />
      </div>

      {!resolvable ? (
        <p className="text-[12px] text-muted-foreground">
          {t("preview.pickAudience")}
        </p>
      ) : isLoading && !preview ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          {t("preview.counting")}
        </p>
      ) : null}

      {/* Live message bubble — rendered on the chat background tint */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background p-3">
        <MessageBubble message={previewMessage} />
      </div>
    </div>
  );
}
