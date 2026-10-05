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
  today,
  doctors,
  summaries,
  selectedId,
  showAll,
  onShowAllChange,
  onPick,
}: {
  mode: "queue" | "book";
  /** Tashkent «YYYY-MM-DD». */
  today: string;
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
  // Booking lists everyone who works in the next 15 days, today's first.
  const list = React.useMemo(() => {
    const ordered = orderTabletDoctors(doctors, summaries, {
      showAll,
      forBooking: mode === "book",
    });
    if (selectedId && !ordered.some((d) => d.id === selectedId)) {
      const chosen = doctors.find((d) => d.id === selectedId);
      if (chosen) return [chosen, ...ordered];
    }
    return ordered;
  }, [doctors, summaries, showAll, selectedId, mode]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-[28px] font-bold leading-tight text-foreground">
          {mode === "book" ? t("titleBook") : t("title")}
        </h2>
        <TouchButton tone="outline" size="lg" onClick={() => onShowAllChange(!showAll)}>
          <UsersIcon />
          {showAll
            ? mode === "book"
              ? t("showBookable")
              : tHome("showOnDuty")
            : tHome("showAll")}
        </TouchButton>
      </div>
      {list.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border bg-card/40 px-6 py-10 text-center text-[17px] text-muted-foreground">
          {mode === "book" ? t("emptyBook") : t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((d) => (
            <DoctorPickTile
              key={d.id}
              doctor={d}
              summary={summaries.get(d.id)}
              bookingToday={mode === "book" ? today : null}
              selected={d.id === selectedId}
              onPick={() => onPick(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
