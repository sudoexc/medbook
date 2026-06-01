"use client";

import * as React from "react";

import { MButton } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

/**
 * Sticky footer with the primary "Продолжить"-style CTA. In Telegram the
 * native MainButton renders the same action at the bottom of the WebView,
 * so we hide this inline copy there (and keep only the tagline strip).
 * Browser/dev context still shows the full inline button as a fallback.
 */
export function WizardFooter({
  primaryLabel,
  onPrimary,
  disabled,
  loading,
  tagline,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
  loading?: boolean;
  tagline?: string;
}) {
  const { isTelegramContext } = useTelegramWebApp();
  if (isTelegramContext) {
    return tagline ? (
      <div
        className="mt-6 px-2 py-3 text-center text-[11px]"
        style={{ color: "var(--tg-hint)" }}
      >
        {tagline}
      </div>
    ) : null;
  }
  return (
    <div className="sticky bottom-0 left-0 right-0 -mx-4 mt-6 border-t px-4 pb-4 pt-3"
      style={{
        backgroundColor: "var(--tg-bg)",
        borderTopColor: "color-mix(in oklch, var(--tg-hint) 15%, transparent)",
      }}
    >
      <MButton
        block
        onClick={onPrimary}
        disabled={disabled || loading}
        aria-busy={loading}
      >
        {loading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            aria-hidden
          />
        ) : null}
        {primaryLabel}
      </MButton>
      {tagline ? (
        <div
          className="mt-2 text-center text-[11px]"
          style={{ color: "var(--tg-hint)" }}
        >
          {tagline}
        </div>
      ) : null}
    </div>
  );
}
