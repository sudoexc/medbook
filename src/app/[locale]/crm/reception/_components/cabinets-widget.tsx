"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { DoorOpenIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CabinetRef } from "../_hooks/use-reception-live";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export interface CabinetsWidgetProps {
  cabinets: CabinetRef[];
  todayRows: AppointmentRow[];
  className?: string;
}

type CabinetBucket = {
  cabinet: CabinetRef;
  occupancy: "free" | "busy" | "overbooked";
  currentCount: number;
  currentDoctorName: string | null;
  untilTime: string | null;
};

/**
 * Right-rail "Кабинеты" per TZ §6.1.4(C).
 *
 * Live occupancy is computed client-side from today's appointments:
 *   - `overbooked` — 2+ records overlap *right now*
 *   - `busy`       — 1 record overlaps *right now*
 *   - `free`       — no overlap
 *
 * TODO(api-builder): extend `/api/crm/cabinets` with a live-occupancy field
 * (currentAppointmentId, nextFreeAt) so this widget doesn't re-derive state
 * per poll. Until then, the derivation below is cheap and accurate.
 */
export function CabinetsWidget({
  cabinets,
  todayRows,
  className,
}: CabinetsWidgetProps) {
  const t = useTranslations("reception.cabinets");
  const locale = useLocale();

  const buckets = React.useMemo<CabinetBucket[]>(() => {
    const now = Date.now();
    return cabinets.map((cabinet) => {
      const active = todayRows.filter((row) => {
        if (row.cabinet?.id !== cabinet.id) return false;
        const start = new Date(row.date).getTime();
        const end = new Date(row.endDate).getTime();
        return start <= now && now < end;
      });
      const count = active.length;
      const occupancy: CabinetBucket["occupancy"] =
        count === 0 ? "free" : count === 1 ? "busy" : "overbooked";
      const next = active[0] ?? null;
      const untilTime = next
        ? fmtTime(new Date(next.endDate), locale)
        : null;
      const currentDoctorName = next
        ? locale === "uz"
          ? next.doctor.nameUz
          : next.doctor.nameRu
        : null;
      return {
        cabinet,
        occupancy,
        currentCount: count,
        currentDoctorName,
        untilTime,
      };
    });
  }, [cabinets, todayRows, locale]);

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <DoorOpenIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {t("subtitle")}
        </span>
      </header>

      <div className="p-3">
        {buckets.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <DoorOpenIcon
              className="size-5 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {buckets.map((b) => (
              <CabinetTile key={b.cabinet.id} bucket={b} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CabinetTile({ bucket }: { bucket: CabinetBucket }) {
  const t = useTranslations("reception.cabinets");
  const { occupancy, cabinet, currentDoctorName, untilTime } = bucket;

  const tone =
    occupancy === "free"
      ? "border-success/30 bg-success/5 text-[color:var(--success)]"
      : occupancy === "busy"
        ? "border-warning/40 bg-warning/10 text-[color:var(--warning-foreground)]"
        : "border-destructive/40 bg-destructive/5 text-destructive";

  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-md border px-2 py-1.5",
        tone,
      )}
      title={
        occupancy === "free"
          ? t("free")
          : occupancy === "busy"
            ? t("busy")
            : t("overbooked")
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tabular-nums">
          №{cabinet.number}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {occupancy === "free"
            ? t("free")
            : occupancy === "busy"
              ? t("busy")
              : t("overbooked")}
        </span>
      </div>
      <p className="truncate text-[11px] text-foreground/80">
        {currentDoctorName
          ? `${currentDoctorName}${
              untilTime ? ` · ${t("untilTime", { time: untilTime })}` : ""
            }`
          : " "}
      </p>
    </li>
  );
}

function fmtTime(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
}
