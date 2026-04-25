"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarPlusIcon,
  CopyIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SendIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Patient } from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";

export interface PatientHeroProps {
  patient: Patient;
  appointments: PatientAppointment[];
  onOpenSmsDialog: () => void;
  onOpenDeleteDialog: () => void;
  onOpenNewAppointmentDialog: () => void;
}

function ageFrom(birthDate: string | null, nowMs: number): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date(nowMs);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function relativeDays(at: string, nowMs: number, locale: string): string {
  const then = new Date(at).getTime();
  const diffDays = Math.round((nowMs - then) / (24 * 60 * 60 * 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === "uz" ? "uz" : "ru", {
    numeric: "auto",
  });
  if (diffDays < 30) return rtf.format(-diffDays, "day");
  const months = Math.round(diffDays / 30);
  if (months < 12) return rtf.format(-months, "month");
  const years = Math.round(diffDays / 365);
  return rtf.format(-years, "year");
}

/**
 * Top dashboard hero for /crm/patients/[id] — docs/7 - Карточка пациента.png.
 * Avatar · name/meta/phone block · 5 inline KPI cells · action-button row.
 */
export function PatientHero({
  patient,
  appointments,
  onOpenSmsDialog,
  onOpenDeleteDialog,
  onOpenNewAppointmentDialog,
}: PatientHeroProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("patientCard.hero");
  const tq = useTranslations("patientCard.quickActions");
  const [nowMs] = React.useState(() => Date.now());

  const age = ageFrom(patient.birthDate, nowMs);
  const shortId = patient.id.slice(0, 6).toUpperCase();

  const completed = appointments.filter((a) => a.status === "COMPLETED");
  const noShow = appointments.filter((a) => a.status === "NO_SHOW");
  const avgCheck =
    completed.length > 0
      ? Math.round(
          completed.reduce((acc, a) => acc + (a.priceFinal ?? 0), 0) /
            completed.length,
        )
      : 0;
  const noShowPct =
    appointments.length > 0
      ? Math.round((noShow.length / appointments.length) * 100)
      : 0;

  const risk: { label: string; tone: "success" | "warning" | "danger" } =
    noShowPct === 0
      ? { label: t("toneLow"), tone: "success" }
      : noShowPct < 15
        ? { label: t("toneMedium"), tone: "warning" }
        : { label: t("toneHigh"), tone: "danger" };

  const currentYear = new Date(nowMs).getFullYear();
  const visitsThisYear = appointments.filter((a) => {
    const d = new Date(a.date);
    return d.getFullYear() === currentYear;
  }).length;

  const ltvTone: "success" | "warning" | "danger" =
    patient.ltv >= 1_000_000
      ? "success"
      : patient.ltv >= 300_000
        ? "warning"
        : "danger";
  const ltvLabel =
    ltvTone === "success"
      ? t("toneHigh")
      : ltvTone === "warning"
        ? t("toneMedium")
        : t("toneLow");

  const copyPhone = () => {
    if (typeof window === "undefined") return;
    void navigator.clipboard
      ?.writeText(patient.phone)
      .then(() => toast.success(t("phoneCopied")));
  };

  const phoneHref = patient.phone
    ? `tel:${patient.phone.replace(/\s/g, "")}`
    : "#";

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-3">
          <div className="relative shrink-0">
            <AvatarWithStatus
              src={patient.photoUrl ?? undefined}
              name={patient.fullName}
              size="xl"
              status="online"
            />
            {patient.segment === "VIP" ? (
              <span className="absolute -top-1 -right-1 inline-flex h-4 items-center rounded bg-info px-1 text-[9px] font-bold uppercase text-white shadow">
                VIP
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-xl font-bold leading-tight text-foreground">
              {patient.fullName}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
              {age !== null ? <span>{t("years", { age })}</span> : null}
              {patient.birthDate ? (
                <>
                  {age !== null ? <span>·</span> : null}
                  <span>{formatDate(patient.birthDate, locale, "short")}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{t("idLabel", { id: shortId })}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
                <PhoneIcon className="size-3.5 text-muted-foreground" />
                {formatPhone(patient.phone)}
                <button
                  type="button"
                  onClick={copyPhone}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("copyPhoneAria")}
                >
                  <CopyIcon className="size-3" />
                </button>
              </span>
              {patient.telegramUsername ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <SendIcon className="size-3.5" />@{patient.telegramUsername}
                </span>
              ) : null}
            </div>
            <span className="mt-1 inline-flex items-center rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              {t("activeBadge")}
            </span>
          </div>
        </div>

        {/* 5 KPI cells */}
        <div className="grid grid-cols-2 gap-4 border-l border-border pl-4 md:grid-cols-3 lg:grid-cols-5">
          <KpiCell
            label={t("kpiLtv")}
            value={<MoneyText amount={patient.ltv} currency="UZS" className="text-lg font-bold" />}
            chip={{ label: ltvLabel, tone: ltvTone }}
          />
          <KpiCell
            label={t("kpiVisits")}
            value={<span className="text-lg font-bold tabular-nums">{patient.visitsCount}</span>}
            hint={
              visitsThisYear > 0
                ? t("visitsThisYear", { count: visitsThisYear })
                : undefined
            }
          />
          <KpiCell
            label={t("kpiAvgCheck")}
            value={
              avgCheck > 0 ? (
                <MoneyText amount={avgCheck} currency="UZS" className="text-lg font-bold" />
              ) : (
                <span className="text-lg font-bold">—</span>
              )
            }
          />
          <KpiCell
            label={t("kpiLastVisit")}
            value={
              patient.lastVisitAt ? (
                <span className="text-lg font-bold tabular-nums">
                  {formatDate(patient.lastVisitAt, locale, "short")}
                </span>
              ) : (
                <span className="text-lg font-bold">—</span>
              )
            }
            hint={
              patient.lastVisitAt
                ? relativeDays(patient.lastVisitAt, nowMs, locale)
                : undefined
            }
          />
          <KpiCell
            label={t("kpiRiskNoShow")}
            value={
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-[13px] font-bold",
                  risk.tone === "success"
                    ? "bg-success/15 text-success"
                    : risk.tone === "warning"
                      ? "bg-warning/15 text-warning"
                      : "bg-destructive/10 text-destructive",
                )}
              >
                {risk.label}
              </span>
            }
            hint={t("riskHint")}
          />
        </div>
      </div>

      {/* Action row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={phoneHref}
          className={cn(buttonVariants({ variant: "outline" }), "h-9 flex-1 min-w-[140px]")}
        >
          <PhoneIcon className="size-4" />
          {t("actionCall")}
        </a>
        {patient.telegramUsername || patient.telegramId ? (
          <Link
            href={`/${locale}/crm/telegram?patientId=${encodeURIComponent(patient.id)}`}
            className={cn(buttonVariants({ variant: "default" }), "h-9 flex-1 min-w-[140px]")}
          >
            <SendIcon className="size-4" />
            {t("actionTelegram")}
          </Link>
        ) : (
          <Button
            variant="default"
            className="h-9 flex-1 min-w-[140px]"
            onClick={() => toast.info(tq("inviteToBot"))}
          >
            <SendIcon className="size-4" />
            {t("actionTelegram")}
          </Button>
        )}
        <Button
          variant="outline"
          className="h-9 flex-1 min-w-[140px]"
          onClick={onOpenNewAppointmentDialog}
        >
          <CalendarPlusIcon className="size-4" />
          {t("actionNewAppointment")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={onOpenSmsDialog}
          aria-label={t("actionSmsAria")}
        >
          <MessageSquareIcon className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 w-9" aria-label={t("actionMoreAria")}>
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => toast.info(tq("mergeDuplicatesSoon"))}
            >
              {tq("mergeDuplicates")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onOpenDeleteDialog}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              {tq("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  chip,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  chip?: { label: string; tone: "success" | "warning" | "danger" };
  hint?: string;
}) {
  const chipClass = chip
    ? chip.tone === "success"
      ? "bg-success/15 text-success"
      : chip.tone === "warning"
        ? "bg-warning/15 text-warning"
        : "bg-destructive/10 text-destructive"
    : "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
      {chip ? (
        <span
          className={cn(
            "inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            chipClass,
          )}
        >
          {chip.label}
        </span>
      ) : null}
      {hint ? (
        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

