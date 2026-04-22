"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { AppointmentRow } from "../_hooks/use-appointments-list";

type DoctorOption = {
  id: string;
  nameRu: string;
  nameUz: string;
  color: string | null;
};

function useDoctors() {
  return useQuery<DoctorOption[], Error>({
    queryKey: ["doctors", "options"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

function useSlotsForDoctor(doctorId: string, enabled: boolean) {
  return useQuery<string[], Error>({
    queryKey: ["appointments", "slots", doctorId, "today"],
    enabled,
    queryFn: async () => {
      const dateIso = new Date().toISOString();
      const res = await fetch(
        `/api/crm/appointments/slots/available?doctorId=${doctorId}&date=${encodeURIComponent(dateIso)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { slots: string[] };
      return j.slots ?? [];
    },
    staleTime: 60_000,
  });
}

export interface AppointmentsRightRailProps {
  rows: AppointmentRow[];
  onSlotPick: (params: { doctorId: string; date: Date; time: string }) => void;
  onExport: () => void;
  onSendRemindersAll: () => void;
}

/**
 * Right rail per TZ §6.2.4:
 *  - quick actions (SMS reminders, export CSV, archive — stub)
 *  - list of free slots today grouped by doctor
 *  - today's summary (count + revenue + avg check)
 */
export function AppointmentsRightRail({
  rows,
  onSlotPick,
  onExport,
  onSendRemindersAll,
}: AppointmentsRightRailProps) {
  const t = useTranslations("appointments.rail");
  const doctors = useDoctors();
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const tomorrow = React.useMemo(
    () => new Date(today.getTime() + 24 * 60 * 60 * 1000),
    [today],
  );

  const todayRows = rows.filter((r) => {
    const d = new Date(r.date);
    return d >= today && d < tomorrow;
  });
  const count = todayRows.length;
  const revenue = todayRows
    .flatMap((r) => r.payments.filter((p) => p.status === "PAID"))
    .reduce((acc, p) => acc + p.amount, 0);
  const avgCheck = count > 0 ? Math.round(revenue / count) : 0;
  const paidRows = todayRows.filter((r) =>
    r.payments.some((p) => p.status === "PAID"),
  ).length;
  const convPct = count > 0 ? Math.round((paidRows / count) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("quickActions")}
        </h4>
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={onSendRemindersAll}
            className="justify-start"
          >
            {t("sendReminders")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            className="justify-start"
          >
            {t("exportCsv")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("freeSlots")}
        </h4>
        <div className="flex max-h-[260px] flex-col gap-3 overflow-y-auto">
          {(doctors.data ?? []).slice(0, 6).map((d) => (
            <SlotsRow
              key={d.id}
              doctor={d}
              onPick={(time) =>
                onSlotPick({ doctorId: d.id, date: new Date(), time })
              }
            />
          ))}
          {!doctors.data?.length ? (
            <p className="text-xs text-muted-foreground">{t("noDoctors")}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("todaySummary")}
        </h4>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t("count")}</dt>
            <dd className="font-medium text-foreground">{count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("revenue")}</dt>
            <dd className="font-medium text-foreground">
              {formatSum(revenue)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("avgCheck")}</dt>
            <dd className="font-medium text-foreground">
              {formatSum(avgCheck)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("conv")}</dt>
            <dd className="font-medium text-foreground">{convPct}%</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function SlotsRow({
  doctor,
  onPick,
}: {
  doctor: DoctorOption;
  onPick: (time: string) => void;
}) {
  const slots = useSlotsForDoctor(doctor.id, true);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: doctor.color ?? "#3DD5C0" }}
          aria-hidden
        />
        <span className="truncate text-xs font-medium text-foreground">
          {doctor.nameRu}
        </span>
      </div>
      {slots.isLoading ? (
        <p className="text-[10px] text-muted-foreground">Загрузка…</p>
      ) : (slots.data ?? []).length === 0 ? (
        <p className="text-[10px] text-muted-foreground">Нет слотов</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {(slots.data ?? []).slice(0, 8).map((time) => (
            <button
              key={`${doctor.id}-${time}`}
              type="button"
              onClick={() => onPick(time)}
              className={cn(
                "rounded-md border border-border bg-background px-2 py-0.5 text-xs tabular-nums transition-colors",
                "hover:bg-primary/10 hover:text-foreground",
              )}
            >
              {time}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatSum(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "0";
  const whole = Math.trunc(amount / 100);
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
