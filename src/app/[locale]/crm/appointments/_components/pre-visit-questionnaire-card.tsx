"use client";

/**
 * Phase 16 Wave 2 — Pre-visit questionnaire summary card.
 *
 * Surfaced inside the appointment drawer between the AI patient summary
 * and the case badge so the doctor sees the patient's self-reported context
 * (complaints, allergies, current medications, notes) before they walk
 * into the consultation.
 *
 * Two visual states:
 *   - "filled" → green pill with the submission timestamp; expandable
 *     panel reveals all four fields.
 *   - "not filled" → muted pill with "Анкета не заполнена" so the doctor
 *     knows the patient never opened the deeplink.
 *
 * The data is delivered with the appointment row itself (added to
 * `AppointmentDetail`); we only re-parse the JSON blob defensively here.
 */
import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronDownIcon, ClipboardListIcon } from "lucide-react";

import { parsePreVisitData } from "@/lib/patient-experience/pre-visit";
import { cn } from "@/lib/utils";

export type PreVisitQuestionnaireCardProps = {
  preVisitData: unknown;
  preVisitSubmittedAt: string | null;
};

export function PreVisitQuestionnaireCard({
  preVisitData,
  preVisitSubmittedAt,
}: PreVisitQuestionnaireCardProps) {
  const t = useTranslations("appointments.drawer.preVisit");
  const fmt = useFormatter();
  const [open, setOpen] = React.useState(false);

  const parsed = parsePreVisitData(preVisitData);
  const filled = Boolean(preVisitSubmittedAt && parsed);

  return (
    <section className="rounded-lg border border-border bg-card/40 p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardListIcon className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground">{t("title")}</h4>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            filled
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {filled ? t("filled") : t("notFilled")}
        </span>
      </header>

      {filled && parsed ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("submittedAt", {
              at: preVisitSubmittedAt
                ? fmt.dateTime(new Date(preVisitSubmittedAt), {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—",
            })}
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                open ? "rotate-180" : "",
              )}
            />
            {open ? t("collapse") : t("expand")}
          </button>
          {open ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Row label={t("complaints")} value={parsed.complaints || "—"} />
              <Row
                label={t("allergies")}
                value={
                  parsed.allergies.length > 0
                    ? parsed.allergies.join(", ")
                    : t("noAllergies")
                }
              />
              <Row
                label={t("medications")}
                value={
                  parsed.medications.length > 0
                    ? parsed.medications.join(", ")
                    : t("noMedications")
                }
              />
              {parsed.notes ? (
                <Row label={t("notes")} value={parsed.notes} />
              ) : null}
            </dl>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
