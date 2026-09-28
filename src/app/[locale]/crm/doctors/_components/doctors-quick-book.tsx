"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";
import { tashkentToday } from "@/lib/tashkent-time";

import type { DoctorRow } from "../_hooks/use-doctors-list";

export interface DoctorsQuickBookProps {
  doctors: DoctorRow[];
  className?: string;
}

/**
 * What the booking dialog opens with: the chosen doctor and day. A past day
 * is never seeded (AP-09); the dialog's slot picker starts at today anyway.
 * The picker's local-midnight Date matches how `SlotPicker` builds its days.
 */
export function quickBookSeed(
  doctorId: string,
  date: string,
  today: string = tashkentToday(),
): { initialDoctorId: string; initialDate: Date } {
  const day = date < today ? today : date;
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return {
    initialDoctorId: doctorId,
    initialDate: new Date(y!, (m ?? 1) - 1, d ?? 1),
  };
}

/**
 * «Быстрая запись к врачу» on the Doctors page (audit DR-05).
 *
 * The widget used to be a mock: hard-coded services and times, and
 * «Создать запись» called an `onCreate` the page never passed, so nothing
 * happened and the desk could believe the patient was booked. It is now a
 * shortcut into the one booking path: pick the doctor and the day, and the
 * button opens `NewAppointmentDialog` with them filled in, where the patient,
 * the doctor's real services and the free slots are chosen and the booking
 * is created like everywhere else.
 */
export function DoctorsQuickBook({ doctors: allDoctors }: DoctorsQuickBookProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.quickBook");
  // Quick booking is NEW work — deactivated doctors are not offered, even
  // though the page grid deliberately lists everyone.
  const doctors = allDoctors.filter((d) => d.isActive);
  const today = tashkentToday();
  const [doctorId, setDoctorId] = React.useState<string>("");
  const [date, setDate] = React.useState<string>(today);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const canSubmit = Boolean(doctorId && date);
  const seed = React.useMemo(
    () => (doctorId ? quickBookSeed(doctorId, date, today) : null),
    [doctorId, date, today],
  );

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <h3 className="text-[13px] font-semibold text-foreground">
        {t("title")}
      </h3>
      <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_160px_auto]">
        <Field label={t("doctor")}>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger>
              <SelectValue placeholder={t("doctorPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {doctors.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("doctorEmpty")}
                </div>
              ) : (
                doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {locale === "uz" ? d.nameUz : d.nameRu}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("date")}>
          <Input
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              // `min` only greys the calendar; a typed past day is ignored.
              if (e.target.value && e.target.value >= today) {
                setDate(e.target.value);
              }
            }}
          />
        </Field>

        <Button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={!canSubmit}
          className="h-9"
        >
          {t("submit")}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t("hint")}</p>

      <NewAppointmentDialog
        open={dialogOpen && seed !== null}
        onOpenChange={setDialogOpen}
        initialDoctorId={seed?.initialDoctorId ?? null}
        initialDate={seed?.initialDate ?? null}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
