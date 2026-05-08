"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Stethoscope } from "lucide-react";

import { useT, useLang } from "./mini-i18n";
import { useTreatmentPlan } from "../_hooks/use-treatment-plan";
import { useActiveContext } from "../_hooks/use-active-context";
import { MCard, MSection, MSpinner } from "./mini-ui";

/**
 * Treatment plan summary card on the Mini App home.
 *
 * Shows the most recently active `MedicalCase` for the active context
 * (self or "on behalf of" relative). Displays "{done} of {total} visits ·
 * next {date}" with a small progress bar and a CTA into the booking flow
 * pre-tagged with `caseId` so the next appointment is auto-attached to the
 * same case.
 *
 * Renders nothing when:
 *   - the query is still loading (we render a small spinner inside MSection)
 *   - there's no active case AND no completed case (the user has no plan)
 *
 * Hidden, not errored, on 4xx — Mini App home should never show a red banner
 * just because no plan exists.
 */
export function TreatmentPlanCard({ slug }: { slug: string }) {
  const t = useT();
  const lang = useLang();
  const { onBehalfOf } = useActiveContext();
  const { data, isLoading, isError } = useTreatmentPlan(onBehalfOf);

  if (isLoading) {
    return (
      <MSection title={t.treatmentPlan.title}>
        <MSpinner />
      </MSection>
    );
  }

  if (isError || !data || !data.active) return null;

  const { active } = data;
  const { progress } = active;
  const pct = Math.max(0, Math.min(100, Math.round(progress.progress * 100)));
  const doctorName = active.primaryDoctor
    ? lang === "UZ"
      ? active.primaryDoctor.nameUz
      : active.primaryDoctor.nameRu
    : null;

  const nextLabel = progress.nextVisitAt
    ? formatShortDate(progress.nextVisitAt, lang)
    : null;

  // Booking deep-link pre-selects the case so the booked appointment is
  // attached to the same `MedicalCase` as the rest of the plan.
  const bookHref = `/c/${slug}/my/book/service?caseId=${encodeURIComponent(active.id)}${
    onBehalfOf ? `&onBehalfOf=${encodeURIComponent(onBehalfOf)}` : ""
  }`;

  return (
    <div className="ma-fade-up" style={{ animationDelay: "30ms" }}>
      <MSection title={t.treatmentPlan.title}>
        <MCard>
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              style={{
                backgroundColor:
                  "color-mix(in oklch, var(--tg-accent) 16%, transparent)",
                color: "var(--tg-accent)",
              }}
            >
              {progress.completed ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Stethoscope className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">
                {active.title}
              </div>
              {doctorName ? (
                <div
                  className="mt-0.5 truncate text-xs"
                  style={{ color: "var(--tg-hint)" }}
                >
                  {doctorName}
                </div>
              ) : null}
              <div
                className="mt-2 text-xs"
                style={{ color: "var(--tg-hint)" }}
              >
                {progress.completed
                  ? t.treatmentPlan.completed
                  : t.treatmentPlan.progress
                      .replace("{done}", String(progress.done))
                      .replace("{total}", String(progress.total))}
                {nextLabel && !progress.completed ? (
                  <>
                    {" · "}
                    <span style={{ color: "var(--tg-text)" }}>
                      {t.treatmentPlan.nextVisit.replace("{date}", nextLabel)}
                    </span>
                  </>
                ) : null}
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full"
                style={{
                  backgroundColor:
                    "color-mix(in oklch, var(--tg-hint) 18%, transparent)",
                }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: "var(--tg-accent)",
                  }}
                />
              </div>
            </div>
          </div>

          {!progress.completed && !progress.nextVisitAt ? (
            <Link
              href={bookHref}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition active:scale-[0.98]"
              style={{ backgroundColor: "var(--tg-accent)" }}
            >
              {t.treatmentPlan.bookCta}
            </Link>
          ) : null}
        </MCard>
        {data.more > 0 ? (
          <p
            className="px-1 text-xs"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.treatmentPlan.moreCases.replace("{n}", String(data.more))}
          </p>
        ) : null}
      </MSection>
    </div>
  );
}

function formatShortDate(iso: string, lang: "RU" | "UZ"): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}
