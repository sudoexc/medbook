"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type PatientSegment = "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";

/**
 * One look per segment, shared by the list's «Статус» column and the card.
 * The chips are pale tints, so the text uses the colour itself (or the
 * darker `warning-text` for amber), never a `*-foreground` token: those are
 * white, meant for solid fills, and vanish on a /15 tint over a white card.
 */
export const SEGMENT_STYLE: Record<
  PatientSegment,
  { tKey: string; className: string }
> = {
  NEW: {
    tKey: "segment.new",
    className: "bg-primary/10 text-primary",
  },
  ACTIVE: {
    tKey: "segment.active",
    className: "bg-success/15 text-success",
  },
  VIP: {
    tKey: "segment.vip",
    className: "bg-info/15 text-info",
  },
  DORMANT: {
    tKey: "segment.dormant",
    className: "bg-warning/15 text-warning-text",
  },
  CHURN: {
    tKey: "segment.churn",
    className: "bg-destructive/10 text-destructive",
  },
};

/**
 * The patient's real status (audit PT-24): the segment the sweep keeps
 * (`src/server/patient/segments.ts`), or «Данные удалены» once a DSAR
 * erasure has anonymised the card. The card used to say «Активный пациент»
 * for everyone, erased cards included.
 */
export function PatientStatusBadge({
  segment,
  deletedAt,
  className,
}: {
  segment: PatientSegment;
  deletedAt?: string | null;
  className?: string;
}) {
  const t = useTranslations("patients");
  const cfg = deletedAt
    ? { tKey: "segment.erased", className: "bg-muted text-muted-foreground" }
    : SEGMENT_STYLE[segment];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
        cfg.className,
        className,
      )}
    >
      {t(cfg.tKey as never)}
    </span>
  );
}
