"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UsersIcon } from "lucide-react";

import { orderTabletDoctors, type DoctorDaySummary } from "@/lib/reception-tablet/doctor-day";

import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { DoctorPickTile } from "./doctor-tile";
import { TouchButton } from "./tablet-ui";

export function DoctorStep({
  mode,
  doctors,
  summaries,
  selectedId,
  showAll,
  onShowAllChange,
  onPick,
}: {
  mode: "queue" | "book";
  doctors: TabletDoctor[];
  summaries: Map<string, DoctorDaySummary>;
  selectedId: string | null;
  showAll: boolean;
  onShowAllChange: (v: boolean) => void;
  onPick: (doctorId: string) => void;
}) {
  const t = useTranslations("receptionTablet.doctor");
  const tHome = useTranslations("receptionTablet.home");
  // The chosen doctor stays on screen even when he is off duty today.
  const list = React.useMemo(() => {
    const ordered = orderTabletDoctors(doctors, summaries, { showAll });
    if (selectedId && !ordered.some((d) => d.id === selectedId)) {
      const chosen = doctors.find((d) => d.id === selectedId);
      if (chosen) return [chosen, ...ordered];
    }
    return ordered;
  }, [doctors, summaries, showAll, selectedId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-[28px] font-bold leading-tight text-foreground">
          {mode === "book" ? t("titleBook") : t("title")}
        </h2>
        <TouchButton tone="outline" size="lg" onClick={() => onShowAllChange(!showAll)}>
          <UsersIcon />
          {showAll ? tHome("showOnDuty") : tHome("showAll")}
        </TouchButton>
      </div>
      {list.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border bg-card/40 px-6 py-10 text-center text-[17px] text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((d) => (
            <DoctorPickTile
              key={d.id}
              doctor={d}
              summary={summaries.get(d.id)}
              selected={d.id === selectedId}
              onPick={() => onPick(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
