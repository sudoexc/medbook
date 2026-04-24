"use client";

import * as React from "react";

/**
 * Wizard header: step badge ("Шаг X из 4"), progress bar, step title and
 * optional subtitle. Rendered above each step's body so the four booking
 * pickers share a consistent progress affordance.
 */
export function WizardHeader({
  step,
  total = 4,
  label,
  title,
  subtitle,
}: {
  step: number;
  total?: number;
  label: string;
  title: string;
  subtitle?: string;
}) {
  const pct = Math.min(100, Math.max(0, (step / total) * 100));
  return (
    <div className="mb-5">
      <div
        className="mb-2 text-xs font-medium"
        style={{ color: "var(--tg-hint)" }}
      >
        {label}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{
          backgroundColor: "color-mix(in oklch, var(--tg-hint) 20%, transparent)",
        }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: "var(--tg-accent)" }}
        />
      </div>
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-sm" style={{ color: "var(--tg-hint)" }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
