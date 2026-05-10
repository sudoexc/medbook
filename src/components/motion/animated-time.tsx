"use client";

import * as React from "react";

import { useCountUp } from "@/components/atoms/count-up";

/**
 * Render a `mm:ss` (or `m:ss`) duration that animates from 0 up to
 * `seconds`. Used for SLA tiles in the action center.
 */
export function AnimatedDuration({
  seconds,
  className,
  format = "m:ss",
  durationMs = 700,
}: {
  seconds: number;
  className?: string;
  format?: "m:ss" | "h:mm";
  durationMs?: number;
}) {
  const v = useCountUp(seconds, durationMs);
  const total = Math.max(0, Math.round(v));
  if (format === "h:mm") {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return (
      <span className={className}>
        {h}:{String(m).padStart(2, "0")}
      </span>
    );
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (
    <span className={className}>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}
