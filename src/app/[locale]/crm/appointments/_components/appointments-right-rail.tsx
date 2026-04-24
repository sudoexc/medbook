"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  BellIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  DownloadIcon,
  SendHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

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

type ActionTone = "primary" | "success" | "warning" | "info";

type ActionItem = {
  key: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  tone: ActionTone;
  onClick: () => void;
};

const TONE_CLASS: Record<ActionTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-[color:var(--success)]",
  warning: "bg-warning/15 text-[color:var(--warning)]",
  info: "bg-info/10 text-[color:var(--info)]",
};

/**
 * Right rail per docs/2 - Записи (2).png:
 *  - "Центр действий" — colored icon cards (reminders / confirmations / export)
 *  - "Свободные слоты сегодня" — compact per-doctor chip list
 *  - "Статистика за сегодня" — numbers grid
 */
export function AppointmentsRightRail({
  rows,
  onSlotPick,
  onExport,
  onSendRemindersAll,
}: AppointmentsRightRailProps) {
  const t = useTranslations("appointments.rail");
  const doctors = useDoctors();
  const [nowMs] = React.useState(() => Date.now());
  const today = React.useMemo(() => startOfDay(new Date(nowMs)), [nowMs]);
  const tomorrow = React.useMemo(
    () => new Date(today.getTime() + 24 * 60 * 60 * 1000),
    [today],
  );

  const todayRows = rows.filter((r) => {
    const d = new Date(r.date);
    return d >= today && d < tomorrow;
  });
  const count = todayRows.length;
  const waiting = todayRows.filter((r) => r.status === "WAITING").length;
  const booked = todayRows.filter((r) => r.status === "BOOKED").length;
  const revenue = todayRows
    .flatMap((r) => r.payments.filter((p) => p.status === "PAID"))
    .reduce((acc, p) => acc + p.amount, 0);
  const avgCheck = count > 0 ? Math.round(revenue / count) : 0;
  const paidRows = todayRows.filter((r) =>
    r.payments.some((p) => p.status === "PAID"),
  ).length;
  const convPct = count > 0 ? Math.round((paidRows / count) * 100) : 0;

  const actions: ActionItem[] = [
    {
      key: "reminders",
      icon: BellIcon,
      title: t("actionRemindTitle"),
      hint: t("actionRemindHint", { count: booked }),
      tone: "primary",
      onClick: onSendRemindersAll,
    },
    {
      key: "confirm",
      icon: CheckCircle2Icon,
      title: t("actionConfirmTitle"),
      hint: t("actionConfirmHint", { count: waiting }),
      tone: "success",
      onClick: onSendRemindersAll,
    },
    {
      key: "broadcast",
      icon: SendHorizontalIcon,
      title: t("actionBroadcastTitle"),
      hint: t("actionBroadcastHint"),
      tone: "info",
      onClick: onSendRemindersAll,
    },
    {
      key: "export",
      icon: DownloadIcon,
      title: t("actionExportTitle"),
      hint: t("actionExportHint"),
      tone: "warning",
      onClick: onExport,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card p-3">
        <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t("actionCenter")}
        </h4>
        <ul className="flex flex-col gap-1.5">
          {actions.map((a) => (
            <ActionCard key={a.key} item={a} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-3">
        <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t("freeSlots")}
        </h4>
        <div className="flex max-h-[260px] flex-col gap-3 overflow-y-auto">
          {(doctors.data ?? []).slice(0, 5).map((d) => (
            <SlotsRow
              key={d.id}
              doctor={d}
              onPick={(time) =>
                onSlotPick({ doctorId: d.id, date: today, time })
              }
            />
          ))}
          {!doctors.data?.length ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("noDoctors")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-3">
        <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t("todayStats")}
        </h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-1">
          <StatCell label={t("count")} value={String(count)} />
          <StatCell label={t("conv")} value={`${convPct}%`} tone="success" />
          <StatCell label={t("revenue")} value={formatSum(revenue)} />
          <StatCell label={t("avgCheck")} value={formatSum(avgCheck)} />
        </dl>
      </section>
    </div>
  );
}

function ActionCard({ item }: { item: ActionItem }) {
  const Icon = item.icon;
  return (
    <li>
      <button
        type="button"
        onClick={item.onClick}
        className="group flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted/40"
      >
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
            TONE_CLASS[item.tone],
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {item.title}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {item.hint}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </li>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-lg font-bold tabular-nums",
          tone === "success" ? "text-[color:var(--success)]" : "text-foreground",
        )}
      >
        {value}
      </dd>
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
  const locale = useLocale();
  const t = useTranslations("appointments.rail");
  const slots = useSlotsForDoctor(doctor.id, true);
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  return (
    <div className="px-1">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: doctor.color ?? "#2b6cff" }}
          aria-hidden
        />
        <span className="truncate text-xs font-semibold text-foreground">
          {name}
        </span>
      </div>
      {slots.isLoading ? (
        <p className="text-[10px] text-muted-foreground">{t("slotsLoading")}</p>
      ) : (slots.data ?? []).length === 0 ? (
        <p className="text-[10px] text-muted-foreground">{t("slotsNone")}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {(slots.data ?? []).slice(0, 8).map((time) => (
            <button
              key={`${doctor.id}-${time}`}
              type="button"
              onClick={() => onPick(time)}
              className={cn(
                "rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                "hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
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
