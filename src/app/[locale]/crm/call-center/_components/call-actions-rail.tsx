"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CopyIcon,
  MicOffIcon,
  PauseIcon,
  PhoneForwardedIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AI_ENABLED } from "@/lib/ai-enabled";
import { InDevelopment } from "@/components/ui/in-development";
import { Button } from "@/components/ui/button";

import type { CallRow } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";
import { EndCallError, useEndCall } from "../_hooks/use-call-notes";

/**
 * Right column — operator control surface.
 *
 * Three stacked cards per docs/6 - Call Center.png:
 *   1. Call controls — real (Hangup / Mark missed) + SIP stubs (Mute / Hold / Transfer).
 *   2. AI hints — static placeholder tile; wired once the AI service is live.
 *   3. Scripts — four canned phrases the operator can copy with one click.
 *
 * The SIP tiles stay disabled until a provider is connected (the disclaimer
 * explains why); the real tiles enable only while a call is in progress. Both
 * stay visible so the operator can see what the surface will offer mid-call.
 */
export function CallActionsRail({ call }: { call: CallRow | null }) {
  const t = useTranslations("callCenter.actionsRail");
  const endCall = useEndCall();

  const status = call ? deriveStatus(call) : null;
  // A call is over once it has an end, whatever the status column says
  // (audit CM-07): the buttons must not offer to end it twice.
  const canEnd =
    Boolean(call) &&
    !call?.endedAt &&
    status !== "ended" &&
    status !== "missed";

  // «Завершить» closes the call as a conversation, «Пропуск» as a missed
  // call to return: the server writes status, direction and duration.
  const onEnd = async (outcome: "ENDED" | "MISSED") => {
    if (!call) return;
    try {
      await endCall.mutateAsync({ id: call.id, outcome });
      toast.success(
        outcome === "MISSED" ? t("toasts.markedMissed") : t("toasts.hangupDone"),
      );
    } catch (e) {
      toast.error(
        e instanceof EndCallError && e.reason === "call_already_ended"
          ? t("toasts.alreadyEnded")
          : t("toasts.endFailed"),
      );
    }
  };

  const onCopyScript = async (text: string) => {
    if (typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("toasts.scriptCopied"));
    } catch {
      toast.error(t("toasts.copyFailed"));
    }
  };

  const scripts = [
    { key: "greeting" as const, text: t("scripts.greeting") },
    { key: "verify" as const, text: t("scripts.verify") },
    { key: "hold" as const, text: t("scripts.hold") },
    { key: "goodbye" as const, text: t("scripts.goodbye") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* ── Call controls ─────────────────────────────────────────────── */}
      <section
        aria-label={t("controls.ariaLabel")}
        className="rounded-xl border border-border bg-background p-3"
      >
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("controls.title")}
          </h3>
        </header>

        <div className="grid grid-cols-3 gap-2">
          <ControlTile
            label={t("controls.hangup")}
            icon={<PhoneOffIcon className="size-5" />}
            tone="danger"
            disabled={!canEnd || endCall.isPending}
            onClick={() => void onEnd("ENDED")}
          />
          <ControlTile
            label={t("controls.markMissed")}
            icon={<PhoneMissedIcon className="size-5" />}
            tone="warning"
            disabled={!canEnd || endCall.isPending}
            onClick={() => void onEnd("MISSED")}
          />
          <ControlTile
            label={t("controls.transfer")}
            icon={<PhoneForwardedIcon className="size-5" />}
            tone="muted"
            disabled
            title={t("toasts.sipUnavailable")}
          />
          <ControlTile
            label={t("controls.mute")}
            icon={<MicOffIcon className="size-5" />}
            tone="muted"
            disabled
            title={t("toasts.sipUnavailable")}
          />
          <ControlTile
            label={t("controls.hold")}
            icon={<PauseIcon className="size-5" />}
            tone="muted"
            disabled
            title={t("toasts.sipUnavailable")}
          />
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("controls.disclaimer")}
        </p>
      </section>

      {/* ── AI helper ─────────────────────────────────────────────────── */}
      <InDevelopment active={!AI_ENABLED}>
      <section
        aria-label={t("aiHints.ariaLabel")}
        className="rounded-xl border border-border bg-background p-3"
      >
        <header className="mb-2 flex items-center gap-2">
          <SparklesIcon
            className="size-4 text-info"
            aria-hidden
          />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("aiHints.title")}
          </h3>
        </header>
        <ul className="space-y-1.5">
          {[0, 1, 2].map((idx) => (
            <li
              key={idx}
              className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[12px] leading-snug text-foreground"
            >
              {t(`aiHints.tip${idx + 1}`)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("aiHints.disclaimer")}
        </p>
      </section>
      </InDevelopment>

      {/* ── Scripts ───────────────────────────────────────────────────── */}
      <section
        aria-label={t("scripts.ariaLabel")}
        className="rounded-xl border border-border bg-background p-3"
      >
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("scripts.title")}
          </h3>
        </header>
        <ul className="space-y-2">
          {scripts.map((s) => (
            <li
              key={s.key}
              className="group flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-[12px] leading-snug"
            >
              <span className="flex-1 whitespace-pre-line text-foreground">
                {s.text}
              </span>
              <button
                type="button"
                onClick={() => onCopyScript(s.text)}
                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                aria-label={t("scripts.copy")}
              >
                <CopyIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ControlTile({
  label,
  icon,
  tone,
  disabled,
  onClick,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  tone: "danger" | "warning" | "muted";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "motion-press flex h-auto flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted",
        toneClass,
      )}
    >
      <span aria-hidden>{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </Button>
  );
}
