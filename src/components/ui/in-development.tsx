"use client";

import * as React from "react";
import { ConstructionIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Dims a paused feature and overlays an "in development" badge. Used to park
 * AI panels while the AI surface is switched off (see `AI_ENABLED`) without
 * tearing their markup out — flipping the flag brings them straight back.
 */
export function InDevelopment({
  children,
  className,
  label,
  active = true,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
  /** When false, children render untouched (feature is live again). */
  active?: boolean;
}) {
  const t = useTranslations("ai");
  if (!active) return <>{children}</>;
  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none select-none opacity-40 grayscale"
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur-sm">
          <ConstructionIcon className="size-3.5" />
          {label ?? t("inDevelopment")}
        </span>
      </div>
    </div>
  );
}
