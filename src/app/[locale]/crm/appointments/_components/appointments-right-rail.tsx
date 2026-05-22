"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  HistoryIcon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  SendHorizontalIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CountUp } from "@/components/atoms/count-up";
import { AnimatedMoney } from "@/components/motion/animated-money";

import type { AppointmentRow } from "../_hooks/use-appointments-list";

type DoctorOption = {
  id: string;
  nameRu: string;
  nameUz: string;
  color: string | null;
  cabinet?: { number: string } | null;
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

export type ReminderTrigger =
  | "appointment.reminder-24h"
  | "appointment.reminder-5h"
  | "appointment.reminder-2h";

export interface AppointmentsRightRailProps {
  rows: AppointmentRow[];
  selectedDoctorId?: string | null;
  onSlotPick: (params: { doctorId: string; date: Date; time: string }) => void;
  onSendReminders: (
    appointmentIds: string[],
    trigger?: ReminderTrigger,
  ) => void;
  remindersBusy?: boolean;
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
  selectedDoctorId = null,
  onSlotPick,
  onSendReminders,
  remindersBusy = false,
}: AppointmentsRightRailProps) {
  const t = useTranslations("appointments.rail");
  const doctors = useDoctors();
  const freeSlotDoctors = React.useMemo(() => {
    const all = doctors.data ?? [];
    if (!selectedDoctorId) return all;
    return all.filter((d) => d.id === selectedDoctorId);
  }, [doctors.data, selectedDoctorId]);

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
        onCta={() =>
          onSendReminders(
            bookedRows.map((r) => r.id),
            "appointment.reminder-2h",
          )
        }
        ctaDisabled={remindersBusy || bookedRows.length === 0}
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
        onCta={() =>
          onSendReminders(
            waitingRows.map((r) => r.id),
            "appointment.reminder-2h",
          )
        }
        ctaDisabled={remindersBusy || waitingRows.length === 0}
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
        onCta={() =>
          onSendReminders(
            todayRows
              .filter(
                (r) => r.status === "BOOKED" || r.status === "WAITING",
              )
              .map((r) => r.id),
            "appointment.reminder-2h",
          )
        }
        ctaDisabled={remindersBusy || todayRows.length === 0}
        moreLabel={t("moreActions")}
      >
        <p className="px-1 text-[12px] text-muted-foreground">
          {t("actionBroadcastBody")}
        </p>
      </ActionBigCard>

      {/* Free slots */}
      <FreeSlotsSection
        doctors={freeSlotDoctors}
        today={today}
        onSlotPick={onSlotPick}
        lastUpdatedMin={lastUpdatedMin}
      />

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
            <AnimatedMoney amount={revenue} currency="UZS" />
          </span>
        </div>
      </section>
    </div>
  );
}

function FreeSlotsSection({
  doctors,
  today,
  onSlotPick,
  lastUpdatedMin,
}: {
  doctors: DoctorOption[];
  today: Date;
  onSlotPick: (params: { doctorId: string; date: Date; time: string }) => void;
  lastUpdatedMin: number;
}) {
  const t = useTranslations("appointments.rail");
  const [expanded, setExpanded] = React.useState(false);

  // Fan-out slot fetches at the parent so we can filter doctors who actually
  // have free slots today — showing rows with "—" for fully-booked doctors
  // was misleading (looked like the widget was broken).
  const slotQueries = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ["appointments", "slots", d.id, "today"] as const,
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        const dateIso = new Date().toISOString();
        const res = await fetch(
          `/api/crm/appointments/slots/available?doctorId=${d.id}&date=${encodeURIComponent(dateIso)}`,
          { credentials: "include", signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { slots: string[] };
        return j.slots ?? [];
      },
      staleTime: 60_000,
    })),
  });

  const withSlots = React.useMemo(
    () =>
      doctors
        .map((d, i) => ({ doctor: d, firstSlot: slotQueries[i]?.data?.[0] ?? null }))
        .filter((x) => x.firstSlot !== null),
    [doctors, slotQueries],
  );

  const anyLoading = slotQueries.some((q) => q.isLoading);
  const visible = expanded ? withSlots : withSlots.slice(0, 3);

  return (
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
        {visible.map(({ doctor, firstSlot }) => (
          <SlotRow
            key={doctor.id}
            doctor={doctor}
            firstSlot={firstSlot}
            onPick={(time) =>
              onSlotPick({ doctorId: doctor.id, date: today, time })
            }
          />
        ))}
        {doctors.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            {t("noDoctors")}
          </p>
        ) : withSlots.length === 0 && !anyLoading ? (
          <p className="px-1 text-xs text-muted-foreground">
            {t("freeSlotsAllBooked")}
          </p>
        ) : null}
      </ul>
      {withSlots.length > 3 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="motion-press mt-2 inline-flex items-center gap-1 px-1 text-[12px] font-semibold text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3.5" />
              {t("freeSlotsCollapse")}
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3.5" />
              {t("freeSlotsShowAll", { count: withSlots.length })}
            </>
          )}
        </button>
      ) : null}
    </section>
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
  ctaDisabled = false,
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
  ctaDisabled?: boolean;
  moreLabel: string;
  children?: React.ReactNode;
}) {
  const palette = TONE[tone];
  return (
    <section className="motion-fade-in flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5">
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
          disabled={ctaDisabled}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-semibold transition-colors motion-press",
            "hover:border-primary/40 hover:bg-primary/5",
            "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-background",
            palette.iconFg,
          )}
        >
          <CtaIcon className="size-4" />
          {ctaLabel}
        </button>
        <ActionBigCardMenu moreLabel={moreLabel} />
      </footer>
    </section>
  );
}

function ActionBigCardMenu({ moreLabel }: { moreLabel: string }) {
  const t = useTranslations("appointments.rail");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  // The card's primary CTA already sends the reminder. This overflow menu
  // routes to the surfaces that let the receptionist tweak templates / read
  // history / drop into the campaign editor — i.e. everything *adjacent* to
  // the one-click send.
  const items = [
    {
      label: t("moreOpenCampaigns"),
      href: `/${locale}/crm/notifications`,
      icon: SendHorizontalIcon,
    },
    {
      label: t("moreHistory"),
      href: `/${locale}/crm/notifications?tab=history`,
      icon: HistoryIcon,
    },
    {
      label: t("moreTemplates"),
      href: `/${locale}/crm/notifications?tab=templates`,
      icon: SettingsIcon,
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={moreLabel}
          className="motion-press inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/50 hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              <Icon className="size-4 text-muted-foreground" />
              {it.label}
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
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
  firstSlot,
  onPick,
}: {
  doctor: DoctorOption;
  firstSlot: string | null;
  onPick: (time: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("appointments.rail");
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const cabinet = doctor.cabinet?.number ?? null;

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
      {cabinet ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t("freeSlotsCabinet", { n: cabinet })}
        </span>
      ) : null}
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
        <span className="font-semibold text-foreground">
          <CountUp to={value} />
        </span>
        {typeof pct === "number" ? (
          <span className="w-9 text-right text-[12px] text-muted-foreground">
            <CountUp to={pct} />%
          </span>
        ) : (
          <span className="w-9" />
        )}
      </span>
    </div>
  );
}

