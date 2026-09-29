"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { formatAdditionalDiagnoses } from "@/lib/visit-diagnoses";

/**
 * «Сопутствующие: M54.2 · Цервикалгия; …» under a visit's main diagnosis in
 * the history lists. A visit has up to three more since 29.09.2026, and a
 * list that showed only the main one read as if the others had been lost.
 * Renders nothing for a visit with a single diagnosis.
 */
export function AdditionalDiagnosesLine({
  diagnoses,
  className,
}: {
  /** `additionalDiagnoses` as the API hands it back (the stored JSON). */
  diagnoses: unknown;
  className?: string;
}) {
  const t = useTranslations("doctor.reception.diagnosis");
  const list = formatAdditionalDiagnoses(diagnoses);
  if (!list) return null;
  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      {t("additionalList", { list })}
    </div>
  );
}
