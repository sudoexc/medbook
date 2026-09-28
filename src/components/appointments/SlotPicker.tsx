"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { tashkentToday } from "@/lib/tashkent-time";
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

  // AP-09 — nothing is booked or moved into the past: the calendar starts at
  // the clinic's today (`min`), a past day offers no slots (the server has
  // none for it either) and detectConflicts answers in_past on submit.
  const minDate = tashkentToday();
  const shownDate = formatDateInput(date);
  const isPast = shownDate < minDate;

  // The last date the desk typed. Chrome commits a typed date segment by
  // segment, so 05.10 typed over 28.09 passes through 05.09, a day behind
  // today. That step has to reach the parent and come back unchanged: a
  // controlled input whose change is refused snaps back to 28.09 and the
  // month then lands on 28.10, the wrong day with no message. A typed past
  // day is therefore kept and flagged below, never rejected or moved.
  const typedRef = React.useRef<string | null>(null);

  // A past day handed in from outside (a past slot clicked in the calendar,
  // the drawer of yesterday's missed booking) opens on today instead, where
  // the desk rebooks it. Only a date the desk did not type is moved.
  React.useEffect(() => {
    if (shownDate < minDate && shownDate !== typedRef.current) {
      onDateChange?.(parseDateInput(minDate));
    }
  }, [shownDate, minDate, onDateChange]);

  const query = useQuery<SlotsResponse, Error>({
    queryKey: [
      "appointments",
      "slots",
      doctorId,
      date.toISOString().slice(0, 10),
      serviceIds.slice().sort().join(","),
    ],
    // A past day has no slots; no request per intermediate typed value.
    enabled: Boolean(doctorId) && !isPast,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("doctorId", doctorId!);
      params.set("date", date.toISOString());
      for (const sid of serviceIds) params.append("serviceIds", sid);
      const res = await fetch(
        `/api/crm/appointments/slots/available?${params.toString()}`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SlotsResponse;
    },
    // Live picker — never reuse a cached slot grid. A booking made in another
    // tab / a just-cancelled appt would otherwise still appear free for up to
    // staleTime and lead the user into a 409 doctor_busy after submit.
    staleTime: 0,
    refetchOnWindowFocus: true,
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
          min={minDate}
          value={shownDate}
          aria-invalid={isPast || undefined}
          aria-describedby={isPast ? "slot-date-past" : undefined}
          onChange={(e) => {
            // Every complete value goes to the parent, a past one included
            // (see typedRef). `min` only greys the calendar popup.
            if (!e.target.value) return;
            typedRef.current = e.target.value;
            onDateChange?.(parseDateInput(e.target.value));
          }}
          className="h-9 w-full"
          disabled={disabled}
        />
      </div>

      {isPast ? (
        <p id="slot-date-past" className="text-xs text-destructive">
          {t("pastDate")}
        </p>
      ) : null}

      {!doctorId ? (
        <p className="text-xs text-muted-foreground">{t("pickDoctorFirst")}</p>
      ) : isPast ? null : query.isLoading ? (
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

// A year typed digit by digit passes through 0002, 0020, 0202: the value must
// survive the round trip through the parent (4-digit year, and setFullYear
// because `new Date(2, …)` means 1902).
function formatDateInput(d: Date): string {
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateInput(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const out = new Date(2000, 0, 1);
  out.setFullYear(y!, (m ?? 1) - 1, d ?? 1);
  return out;
}
