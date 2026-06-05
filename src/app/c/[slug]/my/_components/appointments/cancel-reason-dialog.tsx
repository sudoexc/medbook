"use client";

import * as React from "react";

import { MButton } from "../mini-ui";
import { useT } from "../mini-i18n";

/**
 * `CancelReasonDialog` — bottom-sheet modal that asks the patient WHY they
 * are cancelling before firing the DELETE. Per TZ §5.2.
 *
 * Preset mapping (emitted via `onConfirm`):
 *   1 → "patient:cant-come"
 *   2 → "patient:unwell"
 *   3 → "patient:wants-reschedule"
 *   custom (non-empty) → `"patient:custom: <trimmed>"`
 *   no choice / empty custom → null
 *
 * Preset 3 also surfaces a "reschedule instead" CTA that calls
 * `onPickReschedule` instead of going through the cancel mutation.
 */

type Preset = "p1" | "p2" | "p3" | "custom";

export type CancelReasonDialogProps = {
  open: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
  onPickReschedule?: () => void;
};

function presetToReason(
  preset: Preset | null,
  customText: string,
): string | null {
  if (preset === "p1") return "patient:cant-come";
  if (preset === "p2") return "patient:unwell";
  if (preset === "p3") return "patient:wants-reschedule";
  if (preset === "custom") {
    const trimmed = customText.trim();
    if (!trimmed) return null;
    return `patient:custom: ${trimmed}`;
  }
  return null;
}

export function CancelReasonDialog({
  open,
  isPending,
  onClose,
  onConfirm,
  onPickReschedule,
}: CancelReasonDialogProps) {
  const t = useT();
  const [preset, setPreset] = React.useState<Preset | null>(null);
  const [customText, setCustomText] = React.useState("");

  // Reset state whenever the dialog is reopened so the user gets a clean
  // form (and we don't leak a previous selection into a new attempt).
  React.useEffect(() => {
    if (open) {
      setPreset(null);
      setCustomText("");
    }
  }, [open]);

  if (!open) return null;

  const presets: { id: Preset; label: string }[] = [
    { id: "p1", label: t.appts.cancelReason.preset1 },
    { id: "p2", label: t.appts.cancelReason.preset2 },
    { id: "p3", label: t.appts.cancelReason.preset3 },
  ];

  const handleSubmit = () => {
    onConfirm(presetToReason(preset, customText));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[430px] rounded-t-2xl p-4 pb-8"
        style={{ backgroundColor: "var(--tg-bg)", color: "var(--tg-text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t.appts.cancelReason.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.common.close}
          </button>
        </div>
        <p className="mb-3 text-xs" style={{ color: "var(--tg-hint)" }}>
          {t.appts.cancelReason.subtitle}
        </p>
        <div className="mb-3 space-y-2">
          {presets.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition active:scale-[0.99]"
                style={{
                  backgroundColor: "var(--tg-section-bg)",
                  color: "var(--tg-text)",
                }}
              >
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                  style={{
                    borderColor: active
                      ? "var(--tg-accent)"
                      : "color-mix(in oklch, var(--tg-hint) 50%, transparent)",
                  }}
                >
                  {active ? (
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "var(--tg-accent)" }}
                    />
                  ) : null}
                </span>
                <span className="flex-1">{p.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition active:scale-[0.99]"
            style={{
              backgroundColor: "var(--tg-section-bg)",
              color: "var(--tg-text)",
            }}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
              style={{
                borderColor:
                  preset === "custom"
                    ? "var(--tg-accent)"
                    : "color-mix(in oklch, var(--tg-hint) 50%, transparent)",
              }}
            >
              {preset === "custom" ? (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: "var(--tg-accent)" }}
                />
              ) : null}
            </span>
            <span className="flex-1">{t.appts.cancelReason.customLabel}</span>
          </button>
        </div>
        {preset === "custom" ? (
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            maxLength={300}
            placeholder={t.appts.cancelReason.customPlaceholder}
            rows={3}
            className="mb-3 block w-full resize-none rounded-xl px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--tg-section-bg)",
              color: "var(--tg-text)",
              border:
                "1px solid color-mix(in oklch, var(--tg-hint) 30%, transparent)",
            }}
          />
        ) : null}
        {preset === "p3" && onPickReschedule ? (
          <div className="mb-3">
            <p className="mb-2 text-xs" style={{ color: "var(--tg-hint)" }}>
              {t.appts.cancelReason.rescheduleInsteadHint}
            </p>
            <MButton
              variant="secondary"
              block
              onClick={onPickReschedule}
            >
              {t.appts.cancelReason.rescheduleInstead}
            </MButton>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2">
          <MButton
            variant="danger"
            block
            disabled={isPending}
            onClick={handleSubmit}
          >
            {t.appts.cancelReason.submit}
          </MButton>
          <MButton variant="ghost" block onClick={onClose}>
            {t.appts.cancelReason.back}
          </MButton>
        </div>
      </div>
    </div>
  );
}
