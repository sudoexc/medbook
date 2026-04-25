"use client";

import * as React from "react";
import { useTheme } from "@/components/providers/theme-provider";

/**
 * Resolves the design-token chart palette from CSS custom properties so
 * Recharts SVG receives concrete hex values that respect light/dark theme.
 * Re-reads on theme change.
 */
export function useChartColors() {
  const { resolvedTheme } = useTheme();
  const [palette, setPalette] = React.useState(() => readPalette());
  React.useEffect(() => {
    setPalette(readPalette());
  }, [resolvedTheme]);
  return palette;
}

function readPalette() {
  if (typeof window === "undefined") {
    return FALLBACK;
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    chart1: v("--chart-1", FALLBACK.chart1),
    chart2: v("--chart-2", FALLBACK.chart2),
    chart3: v("--chart-3", FALLBACK.chart3),
    chart4: v("--chart-4", FALLBACK.chart4),
    chart5: v("--chart-5", FALLBACK.chart5),
    border: v("--border", FALLBACK.border),
    mutedForeground: v("--muted-foreground", FALLBACK.mutedForeground),
    warning: v("--warning", FALLBACK.warning),
    destructive: v("--destructive", FALLBACK.destructive),
    success: v("--success", FALLBACK.success),
  };
}

const FALLBACK = {
  chart1: "#2b6cff",
  chart2: "#16c784",
  chart3: "#f59e0b",
  chart4: "#8b5cf6",
  chart5: "#ef4444",
  border: "#e5e9f0",
  mutedForeground: "#64748b",
  warning: "#f59e0b",
  destructive: "#ef4444",
  success: "#16c784",
};
