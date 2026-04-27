"use client";

import * as React from "react";
import { useLocale } from "next-intl";

/**
 * Animate a numeric value from its current display value to `target` using
 * an ease-out cubic curve over `durationMs` ms.
 *
 * - Honors `prefers-reduced-motion`: snaps to target without animation.
 * - On mount the hook starts from 0 (so KPI tiles count up from zero on first
 *   render); subsequent target changes animate from the current value.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = React.useState(0);
  const valueRef = React.useRef(0);
  valueRef.current = value;

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!Number.isFinite(target)) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

export interface CountUpProps {
  to: number;
  durationMs?: number;
  /** Optional formatter; defaults to localized integer with thousands separators. */
  format?: (n: number) => string;
  className?: string;
}

/**
 * Render a number that animates from 0 → `to` on mount.
 * Intended for KPI tiles, dashboard counters, etc.
 */
export function CountUp({ to, durationMs, format, className }: CountUpProps) {
  const locale = useLocale();
  const v = useCountUp(to, durationMs);
  const intlLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
  const text = format
    ? format(v)
    : Math.round(v).toLocaleString(intlLocale);
  return <span className={className}>{text}</span>;
}
