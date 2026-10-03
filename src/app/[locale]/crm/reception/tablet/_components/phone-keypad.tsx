"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { DeleteIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatLocal,
  KEYPAD_ROWS,
  localDigitsFrom,
  pressKey,
  UZ_PREFIX,
  type KeypadKey,
} from "@/lib/reception-tablet/phone";

import { TOUCH } from "./tablet-ui";

/**
 * The phone field: «+998» fixed in front, the national digits after it.
 * A real input (`inputmode="tel"`), so the iPad's own number pad and a paste
 * work too; the on-screen keypad below is the usual way in.
 */
export function PhoneField({
  id,
  local,
  onChange,
  label,
  invalid,
  autoFocus,
}: {
  id: string;
  local: string;
  onChange: (local: string) => void;
  label: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const t = useTranslations("receptionTablet.patient");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[15px] font-semibold text-muted-foreground">
        {label}
      </label>
      <div
        className={cn(
          "flex h-[4.5rem] items-center gap-3 rounded-2xl border bg-card px-5 focus-within:ring-2 focus-within:ring-ring",
          invalid ? "border-destructive" : "border-border",
        )}
      >
        <span className="select-none text-[28px] font-semibold tabular-nums text-muted-foreground">
          {UZ_PREFIX}
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          placeholder={t("phonePlaceholder")}
          value={formatLocal(local)}
          onChange={(e) => {
            const next = localDigitsFrom(e.target.value);
            // Backspace over a group space leaves the digits as they were;
            // take it as deleting a digit, or the key would seem dead.
            const erasedSpace =
              next === local && e.target.value.length < formatLocal(local).length;
            onChange(erasedSpace ? local.slice(0, -1) : next);
          }}
          className="min-w-0 flex-1 bg-transparent text-[28px] font-semibold tabular-nums tracking-wide text-foreground outline-none placeholder:text-muted-foreground/40"
        />
      </div>
    </div>
  );
}

/**
 * A phone's 3 × 4 keypad, 72 px keys. Never takes focus from the phone
 * field. With `fieldId`, a key pressed while another field is being typed
 * into (the name above it) closes that field's iPad keyboard, which would
 * otherwise cover the keypad.
 */
export function PhoneKeypad({
  local,
  onChange,
  fieldId,
}: {
  local: string;
  onChange: (local: string) => void;
  /** The PhoneField this keypad types into. */
  fieldId?: string;
}) {
  const t = useTranslations("receptionTablet.patient");
  const press = (key: KeypadKey) => {
    const focused = typeof document !== "undefined" ? document.activeElement : null;
    if (
      fieldId &&
      focused instanceof HTMLElement &&
      focused.id !== fieldId &&
      focused.matches("input, textarea")
    ) {
      focused.blur();
    }
    onChange(pressKey(local, key));
  };
  return (
    <div role="group" aria-label={t("keypad")} className="grid grid-cols-3 gap-3">
      {KEYPAD_ROWS.flat().map((key) => (
        <button
          key={key}
          type="button"
          // Keep the caret (and the iPad keyboard, if open) where it is.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => press(key)}
          aria-label={key === "back" ? t("backspace") : key === "clear" ? t("clear") : key}
          className={cn(
            TOUCH,
            "motion-press flex h-[4.5rem] items-center justify-center rounded-2xl border text-[28px] font-semibold tabular-nums transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            key === "back" || key === "clear"
              ? "border-transparent bg-muted text-muted-foreground active:bg-muted/70"
              : "border-border bg-card text-foreground active:bg-muted",
          )}
        >
          {key === "back" ? (
            <DeleteIcon className="size-7" aria-hidden />
          ) : key === "clear" ? (
            <span className="text-[17px]">{t("clear")}</span>
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
