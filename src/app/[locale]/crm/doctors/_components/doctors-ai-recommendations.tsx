"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { SparklesIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAgg } from "../_hooks/use-doctors-stats";

export interface DoctorsAiRecommendationsProps {
  doctors: DoctorRow[];
  aggByDoctor: Map<string, DoctorAgg>;
  dayCapacity: number;
  className?: string;
}

type Rec = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
};

/**
 * Reassignment candidate as returned by `GET /api/crm/ai/reassign`. Mirrors
 * the pure-engine output but kept local so this client component never imports
 * `@/lib/ai/*` types into the bundle.
 */
type ReassignCandidate = {
  appointmentId: string;
  fromDoctorId: string;
  toDoctorId: string;
  reason: "overdue" | "absent" | "overloaded";
  estDelaySaved: number;
};

type ReassignResponse = {
  candidates: ReassignCandidate[];
  loads: Array<{ doctorId: string; delayMin: number; remainingTodayMin: number; capacityRemainingMin: number }>;
};

async function fetchReassign(signal?: AbortSignal): Promise<ReassignResponse> {
  const res = await fetch("/api/crm/ai/reassign", {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to load AI reassign: ${res.status}`);
  }
  return (await res.json()) as ReassignResponse;
}

function useAiReassign() {
  return useQuery<ReassignResponse>({
    queryKey: ["ai", "reassign"],
    queryFn: ({ signal }) => fetchReassign(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase() ?? ""}.`;
  }
  return name;
}

/**
 * Derives a small set of actionable suggestions from today's state:
 * redirects, idle windows, overload flags, and evening demand.
 */
export function DoctorsAiRecommendations({
  doctors,
  aggByDoctor,
  dayCapacity,
  className,
}: DoctorsAiRecommendationsProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.ai");
  const aiReassign = useAiReassign();

  const doctorById = React.useMemo(() => {
    const m = new Map<string, DoctorRow>();
    for (const d of doctors) m.set(d.id, d);
    return m;
  }, [doctors]);

  /**
   * Live AI candidates → `Rec` shape. Prepended to the heuristic list (which
   * still serves as a graceful fallback when the engine returns nothing —
   * e.g. brand-new clinics, off-hours).
   */
  const aiRecs = React.useMemo<Rec[]>(() => {
    const candidates = aiReassign.data?.candidates ?? [];
    if (candidates.length === 0) return [];
    const out: Rec[] = [];
    // Cap at 2 so we leave room for the heuristic recs below the fold.
    for (const c of candidates.slice(0, 2)) {
      const fromDoc = doctorById.get(c.fromDoctorId);
      const toDoc = doctorById.get(c.toDoctorId);
      if (!fromDoc || !toDoc) continue;
      out.push({
        id: `reassign:${c.appointmentId}`,
        title: t("redirectTitle", {
          name: shortName(locale === "uz" ? toDoc.nameUz : toDoc.nameRu),
        }),
        description: t("redirectDescription", {
          from: shortName(locale === "uz" ? fromDoc.nameUz : fromDoc.nameRu),
        }),
        actionLabel: t("redirectAction"),
      });
    }
    return out;
  }, [aiReassign.data, doctorById, locale, t]);

  const recs = React.useMemo<Rec[]>(() => {
    const out: Rec[] = [];
    if (doctors.length === 0) return out;
    const enriched = doctors.map((d) => {
      const a = aggByDoctor.get(d.id);
      const today = a?.todayCount ?? 0;
      const load = dayCapacity > 0 ? today / dayCapacity : 0;
      return {
        doctor: d,
        load,
        today,
      };
    });
    const overloaded = enriched.filter((x) => x.load > 0.85).sort((a, b) => b.load - a.load);
    const idle = enriched.filter((x) => x.load < 0.4).sort((a, b) => a.load - b.load);

    if (overloaded.length > 0 && idle.length > 0) {
      const fromDoc = overloaded[0]!.doctor;
      const toDoc = idle[0]!.doctor;
      out.push({
        id: "redirect",
        title: t("redirectTitle", {
          name: shortName(locale === "uz" ? toDoc.nameUz : toDoc.nameRu),
        }),
        description: t("redirectDescription", {
          from: shortName(locale === "uz" ? fromDoc.nameUz : fromDoc.nameRu),
        }),
        actionLabel: t("redirectAction"),
      });
    }

    if (idle.length > 0) {
      const doc = idle[0]!.doctor;
      out.push({
        id: "fill",
        title: t("fillTitle", {
          name: shortName(locale === "uz" ? doc.nameUz : doc.nameRu),
        }),
        description: t("fillDescription"),
        actionLabel: t("fillAction"),
      });
    }

    if (overloaded.length > 0) {
      const doc = overloaded[0]!.doctor;
      out.push({
        id: "specialist",
        title: t("specialistTitle", {
          name: shortName(locale === "uz" ? doc.nameUz : doc.nameRu),
        }),
        description: t("specialistDescription"),
        actionLabel: t("specialistAction"),
      });
    }

    if (enriched.length > 0) {
      const doc = enriched[0]!.doctor;
      out.push({
        id: "evening",
        title: t("eveningTitle", {
          name: shortName(locale === "uz" ? doc.nameUz : doc.nameRu),
        }),
        description: t("eveningDescription"),
        actionLabel: t("eveningAction"),
      });
    }

    return out.slice(0, 4);
  }, [doctors, aggByDoctor, dayCapacity, locale, t]);

  // Merge live AI candidates first, then fill remaining slots with heuristic
  // recommendations. Cap at 4 entries total — same as the original UI budget.
  const mergedRecs = React.useMemo<Rec[]>(() => {
    const seen = new Set<string>();
    const out: Rec[] = [];
    for (const r of aiRecs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      if (out.length >= 4) return out;
    }
    for (const r of recs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      if (out.length >= 4) return out;
    }
    return out;
  }, [aiRecs, recs]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <SparklesIcon className="size-3.5 text-primary" />
          {t("title")}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {t("updated")}
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {mergedRecs.length === 0 ? (
          <li className="text-[12px] text-muted-foreground">
            {t("emptyList")}
          </li>
        ) : (
          mergedRecs.map((r, i) => (
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
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                {r.actionLabel}
              </Button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
