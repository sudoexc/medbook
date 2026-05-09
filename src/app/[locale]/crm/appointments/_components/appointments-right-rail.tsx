"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney, type Locale } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ClockIcon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  SendHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=50`, {
        credentials: "include",
        signal,
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
    queryFn: async ({ signal }) => {
      const dateIso = new Date().toISOString();
      const res = await fetch(
        `/api/crm/appointments/slots/available?doctorId=${doctorId}&date=${encodeURIComponent(dateIso)}`,
        { credentials: "include", signal },
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

type Tone = "primary" | "success" | "info" | "warning";

const TONE: Record<
  Tone,
  { iconBg: string; iconFg: string; chipBg: string; chipFg: string }
> = {
  primary: {
    iconBg: "bg-primary/10",
    iconFg: "text-primary",
    chipBg: "bg-primary/10",
    chipFg: "text-primary",
  },
  success: {
    iconBg: "bg-success/15",
    iconFg: "text-success",
    chipBg: "bg-success/15",
    chipFg: "text-success",
  },
  info: {
    iconBg: "bg-info/10",
    iconFg: "text-info",
    chipBg: "bg-info/10",
    chipFg: "text-info",
  },
  warning: {
    iconBg: "bg-warning/15",
    iconFg: "text-warning",
    chipBg: "bg-warning/15",
    chipFg: "text-warning",
  },
};

const INITIAL_PALETTE = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-warning/20 text-warning",
  "bg-muted text-foreground",
  "bg-success/15 text-success",
] as const;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Right rail per docs/2 - Записи (2).png — large action cards with avatars,
 * initials chips and primary CTAs, free-slot list, day-stat block.
 */
export function AppointmentsRightRail({
  rows,
  onSlotPick,
  onSendRemindersAll,
}: AppointmentsRightRailProps) {
  const t = useTranslations("appointments.rail");
  const locale = useLocale() as Locale;
  const fmtSum = (amount: number) => formatMoney(amount, "UZS", locale);
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

  const bookedRows = todayRows.filter((r) => r.status === "BOOKED");
  const waitingRows = todayRows.filter((r) => r.status === "WAITING");
  const cancelledRows = todayRows.filter((r) => r.status === "CANCELLED");
  const noShowRows = todayRows.filter((r) => r.status === "NO_SHOW");
  const completedRows = todayRows.filter((r) => r.status === "COMPLETED");
  const confirmedTotal = waitingRows.length + completedRows.length;

  const total = todayRows.length;
  const revenue = todayRows
    .flatMap((r) => r.payments.filter((p) => p.status === "PAID"))
    .reduce((acc, p) => acc + p.amount, 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const broadcastTime = "14:00";
  const lastUpdatedMin = 5;

  return (
    <div className="flex flex-col gap-3">
      <h4 className="px-1 text-[14px] font-bold text-foreground">
        {t("actionCenter")}
      </h4>

      <ActionBigCard
        icon={MegaphoneIcon}
        title={t("actionRemindTitle")}
        subtitle={t("actionRemindHint")}
        count={bookedRows.length}
        tone="primary"
        ctaLabel={t("actionRemindCta")}
        ctaIcon={SendHorizontalIcon}
        onCta={onSendRemindersAll}
        moreLabel={t("moreActions")}
      >
        <AvatarsRow
          rows={bookedRows}
          max={4}
          morePlusLabel={(n) => t("morePlus", { count: n })}
        />
      </ActionBigCard>

      <ActionBigCard
        icon={ClockIcon}
        title={t("actionConfirmTitle")}
        subtitle={t("actionConfirmHint")}
        count={waitingRows.length}
        tone="primary"
        ctaLabel={t("actionConfirmCta")}
        ctaIcon={CheckIcon}
        onCta={onSendRemindersAll}
        moreLabel={t("moreActions")}
      >
        <InitialsChipsRow rows={waitingRows} max={4} />
      </ActionBigCard>

      <ActionBigCard
        icon={SendHorizontalIcon}
        title={t("actionBroadcastTitle")}
        subtitle={t("actionBroadcastHint", { time: broadcastTime })}
        count={1}
        tone="primary"
        ctaLabel={t("actionBroadcastCta")}
        ctaIcon={SendHorizontalIcon}
        onCta={onSendRemindersAll}
        moreLabel={t("moreActions")}
      >
        <p className="px-1 text-[12px] text-muted-foreground">
          {t("actionBroadcastBody")}
        </p>
      </ActionBigCard>

      {/* Free slots */}
      <section className="rounded-2xl border border-border bg-card p-3.5">
        <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
          <h5 className="text-[13px] font-semibold text-foreground">
            {t("freeSlots")}
          </h5>
          <span className="text-[10px] text-muted-foreground">
            {t("freeSlotsUpdated", { min: lastUpdatedMin })}
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {(doctors.data ?? []).slice(0, 3).map((d) => (
            <SlotRow
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
        </ul>
        {doctors.data && doctors.data.length > 3 ? (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 px-1 text-[12px] font-semibold text-primary hover:underline"
          >
            {t("freeSlotsShowAll", { count: doctors.data.length })}
          </button>
        ) : null}
      </section>

      {/* Day stats */}
      <section className="rounded-2xl border border-border bg-card p-3.5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h5 className="text-[13px] font-semibold text-foreground">
            {t("dayStats")}
          </h5>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {t("dayStatsAt", { time: fmtClock(new Date(nowMs)) })}
          </span>
        </div>
        <dl className="flex flex-col gap-1.5 text-[13px]">
          <StatLine label={t("statTotal")} value={total} />
          <StatLine
            label={t("statConfirmed")}
            value={confirmedTotal}
            pct={pct(confirmedTotal)}
          />
          <StatLine
            label={t("statUnconfirmed")}
            value={bookedRows.length}
            pct={pct(bookedRows.length)}
          />
          <StatLine
            label={t("statCancelled")}
            value={cancelledRows.length}
            pct={pct(cancelledRows.length)}
          />
          <StatLine
            label={t("statNoShow")}
            value={noShowRows.length}
            pct={pct(noShowRows.length)}
          />
        </dl>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-[12px] text-muted-foreground">
            {t("statRevenue")}
          </span>
          <span className="text-[15px] font-bold text-foreground tabular-nums">
            {fmtSum(revenue)}
          </span>
        </div>
      </section>
    </div>
  );
}

function ActionBigCard({
  icon: Icon,
  title,
  subtitle,
  count,
  tone,
  ctaLabel,
  ctaIcon: CtaIcon,
  onCta,
  moreLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  count: number;
  tone: Tone;
  ctaLabel: string;
  ctaIcon: LucideIcon;
  onCta: () => void;
  moreLabel: string;
  children?: React.ReactNode;
}) {
  const palette = TONE[tone];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5">
      <header className="flex items-start gap-2.5">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
            palette.iconBg,
            palette.iconFg,
          )}
          aria-hidden
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[14px] font-semibold text-foreground">
              {title}
            </span>
            <span
              className={cn(
                "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-bold tabular-nums",
                palette.chipBg,
                palette.chipFg,
              )}
            >
              {count}
            </span>
          </div>
          <p className="truncate text-[12px] text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </header>

      {children ? <div>{children}</div> : null}

      <footer className="flex items-stretch gap-1.5">
        <button
          type="button"
          onClick={onCta}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-semibold transition-colors",
            "hover:border-primary/40 hover:bg-primary/5",
            palette.iconFg,
          )}
        >
          <CtaIcon className="size-4" />
          {ctaLabel}
        </button>
        <button
          type="button"
          aria-label={moreLabel}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/50 hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}

function AvatarsRow({
  rows,
  max,
  morePlusLabel,
}: {
  rows: AppointmentRow[];
  max: number;
  morePlusLabel: (count: number) => string;
}) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, max);
  const overflow = Math.max(0, rows.length - max);
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="flex -space-x-2">
        {visible.map((r) => (
          <Avatar
            key={r.id}
            className="size-8 ring-2 ring-card"
          >
            {r.patient.photoUrl ? (
              <AvatarImage
                src={r.patient.photoUrl}
                alt={r.patient.fullName}
              />
            ) : null}
            <AvatarFallback className="text-[10px]">
              {deriveInitials(r.patient.fullName)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {overflow > 0 ? (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
          {morePlusLabel(overflow)}
        </span>
      ) : null}
    </div>
  );
}

function InitialsChipsRow({
  rows,
  max,
}: {
  rows: AppointmentRow[];
  max: number;
}) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {visible.map((r, i) => {
        const cls = INITIAL_PALETTE[i % INITIAL_PALETTE.length];
        return (
          <span
            key={r.id}
            title={r.patient.fullName}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-[12px] font-bold",
              cls,
            )}
          >
            {deriveInitials(r.patient.fullName)}
          </span>
        );
      })}
    </div>
  );
}

function SlotRow({
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
  const firstSlot = (slots.data ?? [])[0];
  const cabinetGuess = ((doctor.id.charCodeAt(0) % 5) + 1).toString();

  return (
    <li className="flex items-center gap-2 text-[12px]">
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: "#16a34a" }}
        aria-hidden
      />
      <span className="w-12 shrink-0 font-semibold text-foreground tabular-nums">
        {firstSlot ?? "—"}
      </span>
      <span className="flex-1 truncate text-foreground">{name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {t("freeSlotsCabinet", { n: cabinetGuess })}
      </span>
      <button
        type="button"
        onClick={() => firstSlot && onPick(firstSlot)}
        disabled={!firstSlot}
        className={cn(
          "inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
          firstSlot
            ? "bg-success/15 text-success hover:bg-success/25"
            : "bg-muted text-muted-foreground",
        )}
      >
        {t("freeSlotsBook")}
      </button>
    </li>
  );
}

function StatLine({
  label,
  value,
  pct,
}: {
  label: string;
  value: number;
  pct?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-3 tabular-nums">
        <span className="font-semibold text-foreground">{value}</span>
        {typeof pct === "number" ? (
          <span className="w-9 text-right text-[12px] text-muted-foreground">
            {pct}%
          </span>
        ) : (
          <span className="w-9" />
        )}
      </span>
    </div>
  );
}

