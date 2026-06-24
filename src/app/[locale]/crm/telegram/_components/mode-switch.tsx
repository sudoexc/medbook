"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { BotIcon, HeadsetIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ConversationMode } from "../_hooks/types";
import { useTakeover } from "../_hooks/use-takeover";

/**
 * Single, self-explanatory control for "who answers the patient".
 *
 * Replaces the old pair of controls (a header button + a composer chip) that
 * used three different verbs ("Взять диалог" / "Вернуть боту" / "Перевести на
 * оператора") for the same toggle — operators couldn't tell the current state
 * or what the action would do. This shows BOTH states at once, highlights the
 * active one, and spells out the consequence on the line below.
 */
export function ModeSwitch({
  conversationId,
  mode,
  showHint = true,
}: {
  conversationId: string;
  mode: ConversationMode;
  showHint?: boolean;
}) {
  const t = useTranslations("tgInbox.mode");
  const takeover = useTakeover();
  const isTakeover = mode === "takeover";

  const set = (next: ConversationMode) => {
    if (next === mode || takeover.isPending) return;
    takeover.mutate({ conversationId, mode: next });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="group"
        aria-label={t("title")}
        className={cn(
          "inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5",
          takeover.isPending && "opacity-80",
        )}
      >
        <Segment
          active={!isTakeover}
          pending={takeover.isPending && isTakeover}
          onClick={() => set("bot")}
          icon={<BotIcon className="size-3.5" aria-hidden />}
          label={t("bot")}
          activeClass="bg-card text-primary shadow-sm"
        />
        <Segment
          active={isTakeover}
          pending={takeover.isPending && !isTakeover}
          onClick={() => set("takeover")}
          icon={<HeadsetIcon className="size-3.5" aria-hidden />}
          label={t("operator")}
          activeClass="bg-card text-[color:var(--warning)] shadow-sm"
        />
      </div>
      {showHint ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {isTakeover ? t("operatorHint") : t("botHint")}
        </p>
      ) : null}
    </div>
  );
}

function Segment({
  active,
  pending,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  pending: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed",
        active ? activeClass : "text-muted-foreground hover:text-foreground",
      )}
    >
      {pending ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> : icon}
      <span>{label}</span>
    </button>
  );
}
