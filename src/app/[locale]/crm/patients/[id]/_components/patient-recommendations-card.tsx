"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { Patient } from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";

export interface PatientRecommendationsCardProps {
  patient: Patient;
  appointments: PatientAppointment[];
  className?: string;
}

type Rec = {
  id: string;
  title: string;
  description: string;
};

/** Shown before «Показать все рекомендации» reveals the rest. */
const COLLAPSED_COUNT = 3;

function daysSince(at: string | null, nowMs: number): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / (24 * 60 * 60 * 1000)));
}

export function PatientRecommendationsCard({
  patient,
  appointments,
  className,
}: PatientRecommendationsCardProps) {
  const t = useTranslations("patientCard.recs");
  const [nowMs] = React.useState(() => Date.now());
  const [expanded, setExpanded] = React.useState(false);
  const recs = React.useMemo<Rec[]>(() => {
    const out: Rec[] = [];
    const since = daysSince(patient.lastVisitAt, nowMs);
    if (since !== null) {
      // `nextVisitAt` is computed from the appointments now (audit PT-25),
      // so this no longer fires for a patient already booked. The text
      // states the fact it rests on; it used to invent a date to come back
      // («через 14 - since/2 дней», audit PT-24).
      if (since < 30 && !patient.nextVisitAt) {
        out.push({
          id: "rebook",
          title: t("rebookTitle"),
          description: t("rebookDesc", { days: since }),
        });
      } else if (since >= 60) {
        out.push({
          id: "reactivate",
          title: t("reactivateTitle"),
          description: t("reactivateDesc"),
        });
      }
    }

    // A Telegram reminder needs Telegram to send it through.
    if (patient.nextVisitAt && patient.telegramId) {
      out.push({
        id: "reminder",
        title: t("reminderTitle"),
        description: t("reminderDesc"),
      });
    }

    if (patient.segment === "VIP") {
      out.push({
        id: "course",
        title: t("courseTitle"),
        description: t("courseDesc"),
      });
    } else if (patient.ltv >= 300_000) {
      out.push({
        id: "upsell",
        title: t("upsellTitle"),
        description: t("upsellDesc"),
      });
    }

    const completed = appointments.filter((a) => a.status === "COMPLETED");
    if (completed.length >= 3 && !out.find((r) => r.id === "course")) {
      out.push({
        id: "loyalty",
        title: t("loyaltyTitle"),
        description: t("loyaltyDesc", { count: completed.length }),
      });
    }

    return out;
  }, [patient, appointments, nowMs, t]);
  // The button used to do nothing while the list was cut at three (audit
  // UX-13): it now reveals the rest, and only shows when there is a rest.
  const visible = expanded ? recs : recs.slice(0, COLLAPSED_COUNT);
  const hiddenCount = recs.length - visible.length;

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <h3 className="text-[13px] font-semibold text-foreground">
        {t("title")}
      </h3>

      <ol className="mt-3 space-y-2">
        {recs.length === 0 ? (
          <li className="text-[12px] text-muted-foreground">
            {t("empty")}
          </li>
        ) : (
          visible.map((r, i) => (
            <li
              key={r.id}
              className="flex items-start gap-2 rounded-xl border border-border bg-background p-2.5"
            >
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold leading-snug text-foreground">
                  {r.title}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {r.description}
                </div>
              </div>
            </li>
          ))
        )}
      </ol>

      {hiddenCount > 0 ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-[12px]"
            onClick={() => setExpanded(true)}
          >
            {t("viewAll")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
