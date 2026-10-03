"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Touch primitives of the reception tablet, on the CRM's own Button and
 * tokens. Rules every control here keeps: at least 56 px tall, 17 px text or
 * more, no hover-only state (feedback is on press), no text selection on a
 * long press, no double-tap zoom delay.
 */

/** Applied to every tappable element of the tablet. */
export const TOUCH = "select-none touch-manipulation [-webkit-touch-callout:none]";

type Tone = "primary" | "outline" | "success" | "ghost" | "danger";
type Size = "md" | "lg" | "xl";

const TONE: Record<Tone, string> = {
  primary: "",
  outline: "border-border bg-card active:bg-muted",
  success:
    "border-transparent bg-success text-success-foreground active:bg-success/85",
  ghost: "active:bg-muted",
  danger: "border-transparent bg-destructive text-destructive-foreground active:bg-destructive/85",
};

const VARIANT: Record<Tone, "default" | "outline" | "ghost"> = {
  primary: "default",
  outline: "outline",
  success: "default",
  ghost: "ghost",
  danger: "default",
};

const SIZE: Record<Size, string> = {
  md: "h-14 min-w-14 gap-2 rounded-2xl px-5 text-[17px] font-semibold [&_svg:not([class*='size-'])]:size-5",
  lg: "h-16 min-w-16 gap-2.5 rounded-2xl px-6 text-lg font-semibold [&_svg:not([class*='size-'])]:size-6",
  xl: "h-20 min-w-20 gap-3 rounded-3xl px-7 text-[22px] font-bold [&_svg:not([class*='size-'])]:size-7",
};

export interface TouchButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "size" | "variant"> {
  tone?: Tone;
  size?: Size;
}

export function TouchButton({
  tone = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: TouchButtonProps) {
  return (
    <Button
      type={type}
      variant={VARIANT[tone]}
      className={cn(TOUCH, "motion-press", SIZE[size], TONE[tone], className)}
      {...props}
    />
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * A big segmented control in place of a select: every option visible, one
 * tap to switch. With `allowNone`, tapping the picked option clears it
 * (the optional «Пол»).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  allowNone = false,
  label,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T | null;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex w-full rounded-2xl border border-border bg-muted/60 p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(active && allowNone ? null : o.value)}
            className={cn(
              TOUCH,
              "flex h-14 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[17px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground active:bg-card/60",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small uppercase caption above a value, the CRM's section label style. */
export function Caption({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A plain-language error with an optional way out. */
export function ErrorNote({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4 text-[17px] text-destructive",
        className,
      )}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/** The ticket letter of a doctor, big enough to read across the hall. */
export function TicketLetter({
  letter,
  size = "md",
  className,
}: {
  letter: string | null;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl bg-primary-soft font-bold text-primary dark:bg-primary/20",
        size === "lg" ? "size-16 text-3xl" : "size-14 text-2xl",
        className,
      )}
    >
      {letter ?? "·"}
    </span>
  );
}
