"use client";

import * as React from "react";

import { MButton } from "../mini-ui";

/**
 * Sticky footer with the primary "Продолжить"-style CTA. Drawn in-page in both
 * Telegram and browser contexts so the button matches the screen's visual
 * language — we deliberately don't defer to TG's native MainButton anymore.
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
