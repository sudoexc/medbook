"use client";

import { useTranslations } from "next-intl";

import {
  formatAdditionalDiagnoses,
  parseAdditionalDiagnoses,
} from "@/lib/visit-diagnoses";

/**
 * The conclusion header's diagnosis line: the main diagnosis, and «+N» when
 * the visit has others (up to three more since 29.09.2026). The header named
 * only the main one, so a conclusion with four diagnoses looked like one
 * with a single diagnosis until the doctor scrolled to the card. The others
 * are named on hover, and in full in the diagnosis card below.
 */
export function DiagnosisHeading({
  diagnosisCode,
  diagnosisName,
  additionalDiagnoses,
}: {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  /** As the API hands it back (the stored JSON). */
  additionalDiagnoses: unknown;
}) {
  const tr = useTranslations("doctor.conclusions");
  const tDiagnosis = useTranslations("doctor.reception.diagnosis");
  const others = parseAdditionalDiagnoses(additionalDiagnoses);
  // Free text counts: keying the header off the code alone showed «Без
  // диагноза» on conclusions that carry one in words.
  const main = [diagnosisCode, diagnosisName]
    .filter((v) => Boolean(v && v.trim()))
    .join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="truncate text-sm font-semibold text-foreground">
        {main || tr("noDiagnosis")}
      </div>
      {others.length > 0 ? (
        <span
          title={tDiagnosis("additionalList", {
            list: formatAdditionalDiagnoses(others),
          })}
          className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary"
        >
          {tr("detail.moreDiagnoses", { count: others.length })}
        </span>
      ) : null}
    </div>
  );
}
