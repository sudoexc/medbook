"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SlotPickerProps {
  doctorId: string | null;
  date: Date;
  serviceIds: string[];
  value: string | null;
  onChange: (next: { date: Date; time: string }) => void;
  onDateChange?: (d: Date) => void;
  disabled?: boolean;
  /** Render a small compact form (no outer card). */
  compact?: boolean;
}

type SlotsResponse = {
  doctorId: string;
  date: string;
  slotMin: number;
  slots: string[];
};

/**
 * Slot-picker: calls `GET /api/crm/appointments/slots/available` with the
 * selected doctor / date / services and renders the result as a wrapping
 * grid of tappable `HH:mm` chips.
 *
 * Used inside `NewAppointmentDialog` but lives in a standalone module so the
 * calendar-specialist can drop it into the calendar's quick-create panel too.
 */
export function SlotPicker({
  doctorId,
  date,
  serviceIds,
  value,
  onChange,
  onDateChange,
  disabled,
  compact = false,
}: SlotPickerProps) {
  const t = useTranslations("appointments.slotPicker");

  const query = useQuery<SlotsResponse, Error>({
    queryKey: [
      "appointments",
      "slots",
      doctorId,
      date.toISOString().slice(0, 10),
      serviceIds.slice().sort().join(","),
    ],
    enabled: Boolean(doctorId),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("doctorId", doctorId!);
      params.set("date", date.toISOString());
      for (const sid of serviceIds) params.append("serviceIds", sid);
      const res = await fetch(
        `/api/crm/appointments/slots/available?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SlotsResponse;
    },
    staleTime: 30_000,
  });

  const slots = query.data?.slots ?? [];

  return (
    <div className={cn("flex flex-col gap-2", compact ? "" : "rounded-lg border border-border bg-card p-3")}>
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <Label htmlFor="slot-date" className="text-xs text-muted-foreground">
          {t("date")}
        </Label>
        <Input
          id="slot-date"
          type="date"
          value={formatDateInput(date)}
          onChange={(e) => {
            if (!e.target.value) return;
            const next = parseDateInput(e.target.value);
            onDateChange?.(next);
          }}
          className="h-9 w-full"
          disabled={disabled}
        />
      </div>

      {!doctorId ? (
        <p className="text-xs text-muted-foreground">{t("pickDoctorFirst")}</p>
      ) : query.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("loading")}</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive" role="alert">
          {t("loadError")}
        </p>
      ) : slots.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noSlots")}</p>
      ) : (
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup">
          {slots.map((time) => {
            const isActive = value === time;
            return (
              <button
                key={time}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onChange({ date, time })}
                disabled={disabled}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-sm tabular-nums transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {time}
              </button>
            );
          })}
        </div>
      )}

      {query.data?.slotMin ? (
        <p className="text-[10px] text-muted-foreground">
          {t("slotMin", { min: query.data.slotMin })}
        </p>
      ) : null}
    </div>
  );
}

function formatDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateInput(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}
