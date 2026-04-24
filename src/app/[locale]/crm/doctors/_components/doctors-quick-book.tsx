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

import type { DoctorRow } from "../_hooks/use-doctors-list";

export interface DoctorsQuickBookProps {
  doctors: DoctorRow[];
  onCreate?: (payload: {
    doctorId: string;
    service?: string;
    date: string;
    time?: string;
  }) => void;
  className?: string;
}

const SERVICE_KEYS = ["consult", "follow", "procedure", "diagnostic"] as const;
type ServiceKey = (typeof SERVICE_KEYS)[number];
const SERVICE_LABEL: Record<ServiceKey, string> = {
  consult: "serviceConsult",
  follow: "serviceFollow",
  procedure: "serviceProcedure",
  diagnostic: "serviceDiagnostic",
};

const TIMES = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
];

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Inline "Быстрая запись к врачу" widget — docs/6 - Врачи.png.
 * Four lightweight fields (doctor, service, date, time) + a CTA.
 */
export function DoctorsQuickBook({
  doctors,
  onCreate,
}: DoctorsQuickBookProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.quickBook");
  const [doctorId, setDoctorId] = React.useState<string>("");
  const [service, setService] = React.useState<string>("");
  const [date, setDate] = React.useState<string>(() => isoDate(new Date()));
  const [time, setTime] = React.useState<string>("");

  const canSubmit = Boolean(doctorId && date);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate?.({
      doctorId,
      service: service || undefined,
      date,
      time: time || undefined,
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <h3 className="text-[13px] font-semibold text-foreground">
        {t("title")}
      </h3>
      <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_140px_140px_auto]">
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

        <Field label={t("service")}>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger>
              <SelectValue placeholder={t("servicePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_KEYS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(SERVICE_LABEL[s] as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("date")}>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Field label={t("time")}>
          <Select value={time} onValueChange={setTime}>
            <SelectTrigger>
              <SelectValue placeholder={t("timePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {TIMES.map((slot) => (
                <SelectItem key={slot} value={slot}>
                  {slot}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="h-9"
        >
          {t("submit")}
        </Button>
      </div>
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
