"use client";

import * as React from "react";
import { useLocale } from "next-intl";

import { useCountUp } from "@/components/atoms/count-up";

/**
 * Render a percentage that animates from 0 to `value` (0..1 or 0..100).
 * Pass `decimals` to control precision (default 1).
 */
export function AnimatedPercent({
  value,
  decimals = 1,
  fromHundred = false,
  className,
  durationMs = 700,
}: {
  value: number;
  decimals?: number;
  /** Set true if `value` is already a 0..100 percentage. */
  fromHundred?: boolean;
  className?: string;
  durationMs?: number;
}) {
  const locale = useLocale();
  const intlLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
  const target = fromHundred ? value : value * 100;
  const v = useCountUp(target, durationMs);
  return (
    <span className={className}>
      {v.toLocaleString(intlLocale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      %
    </span>
  );
}
