"use client";

/**
 * The «10 · 20 · 30» switch of a «Частые» column and the count pill of its
 * rows (owner request 03.10.2026: «самые частые 10-20-30 назначений и
 * диагнозов»). Shared by the diagnosis and the prescription pickers, so the
 * two columns read and click the same.
 */
import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { SlidersHorizontalIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FREQUENT_LIMITS, type FrequentLimit } from "@/lib/arsenal";

import { isRepeatClick } from "../_hooks/prescription-columns";

/**
 * Three small radio buttons. Small on purpose: it is set once and then
 * left, the rows under it are the targets.
 */
export function TopSwitch({
  value,
  onChange,
}: {
  value: FrequentLimit;
  onChange: (next: FrequentLimit) => void;
}) {
  const t = useTranslations("doctor.reception.topSwitch");
  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      title={t("label")}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {FREQUENT_LIMITS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("option", { n })}
          onClick={(e) => {
            // The columns can move under the cursor (a diagnosis folds
            // them): one gesture, one choice.
            if (isRepeatClick(e.detail)) return;
            if (n !== value) onChange(n);
          }}
          className={cn(
            "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums transition-colors",
            value === n
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** How many times he wrote it: a number in a pill, the meaning on hover. */
export function CountPill({
  n,
  title,
  big = false,
}: {
  n: number;
  title: string;
  big?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold tabular-nums text-primary",
        big ? "h-6 min-w-7 px-1.5 text-[13px]" : "h-5 min-w-6 px-1 text-xs",
      )}
    >
      {n}
    </span>
  );
}

/**
 * The «Мои» header: how many pins, and the way to «Мой арсенал», where the
 * order and the schemas of this very column are set.
 */
export function ArsenalLink({ count }: { count: number }) {
  const t = useTranslations("doctor.reception.topSwitch");
  const locale = useLocale();
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {count > 0 ? (
        <span className="rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      <Link
        href={`/${locale}/doctor/arsenal`}
        title={t("arsenal")}
        aria-label={t("arsenal")}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
      >
        <SlidersHorizontalIcon className="size-4" />
      </Link>
    </span>
  );
}

/** The first rows of «Частые» are the biggest targets. */
export const BIG_ROWS = 5;
