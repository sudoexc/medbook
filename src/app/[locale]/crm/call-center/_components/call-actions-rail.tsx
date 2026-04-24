"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CopyIcon,
  MessageSquareIcon,
  MicOffIcon,
  PauseIcon,
  PhoneForwardedIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { CallRow } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";
import { useCallPatch } from "../_hooks/use-call-notes";

/**
 * Right column — operator control surface.
 *
 * Three stacked cards per docs/6 - Call Center.png:
 *   1. Call controls — real (Hangup / Mark missed) + SIP stubs (Mute / Hold / Transfer).
 *   2. AI hints — static placeholder tile; wired once the AI service is live.
 *   3. Scripts — four canned phrases the operator can copy with one click.
 *
 * When no call is active, every tile is disabled but still visible so the
 * operator understands what actions will be available mid-call.
 */
export function CallActionsRail({ call }: { call: CallRow | null }) {
  const t = useTranslations("callCenter.actionsRail");
  const patch = useCallPatch();

  const status = call ? deriveStatus(call) : null;
  const canEnd =
    Boolean(call) && status !== "ended" && status !== "missed";
  const phone = call
    ? call.direction === "OUT"
      ? call.toNumber
      : call.fromNumber
    : "";

  const onHangup = async () => {
    if (!call) return;
    try {
      await patch.mutateAsync({
        id: call.id,
        patch: { endedAt: new Date().toISOString() },
      });
      toast.success(t("toasts.hangupDone"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onMarkMissed = async () => {
    if (!call) return;
    try {
      await patch.mutateAsync({
        id: call.id,
        patch: {
          endedAt: new Date().toISOString(),
          tags: Array.from(new Set([...call.tags, "missed"])),
        },
      });
      toast.success(t("toasts.markedMissed"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onStub = () => toast.info(t("toasts.sipUnavailable"));

  const onCopyScript = async (text: string) => {
    if (typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("toasts.scriptCopied"));
    } catch {
      toast.error(t("toasts.copyFailed"));
    }
  };

  const smsHref = call?.patient
    ? `/crm/patients/${call.patient.id}?sms=true`
    : phone
      ? `/crm/patients?new=true&phone=${encodeURIComponent(phone)}`
      : "/crm/patients";

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
            disabled={!canEnd || patch.isPending}
            onClick={onHangup}
          />
          <ControlTile
            label={t("controls.markMissed")}
            icon={<PhoneMissedIcon className="size-5" />}
            tone="warning"
            disabled={!canEnd || patch.isPending}
            onClick={onMarkMissed}
          />
          <ControlTile
            label={t("controls.transfer")}
            icon={<PhoneForwardedIcon className="size-5" />}
            tone="muted"
            disabled={!call}
            onClick={onStub}
          />
          <ControlTile
            label={t("controls.mute")}
            icon={<MicOffIcon className="size-5" />}
            tone="muted"
            disabled={!call}
            onClick={onStub}
          />
          <ControlTile
            label={t("controls.hold")}
            icon={<PauseIcon className="size-5" />}
            tone="muted"
            disabled={!call}
            onClick={onStub}
          />
          <Link
            href={smsHref}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted",
              !call && "pointer-events-none opacity-50",
            )}
          >
            <MessageSquareIcon className="size-5 text-primary" aria-hidden />
            <span className="text-[11px] font-medium text-foreground">
              {t("controls.sms")}
            </span>
          </Link>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("controls.disclaimer")}
        </p>
      </section>

      {/* ── AI helper ─────────────────────────────────────────────────── */}
      <section
        aria-label={t("aiHints.ariaLabel")}
        className="rounded-xl border border-border bg-background p-3"
      >
        <header className="mb-2 flex items-center gap-2">
          <SparklesIcon
            className="size-4 text-[color:var(--info,#3b82f6)]"
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
}: {
  label: string;
  icon: React.ReactNode;
  tone: "danger" | "warning" | "muted";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-[color:var(--warning,#f59e0b)]"
        : "text-foreground";
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-auto flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center",
        toneClass,
      )}
    >
      <span aria-hidden>{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </Button>
  );
}
