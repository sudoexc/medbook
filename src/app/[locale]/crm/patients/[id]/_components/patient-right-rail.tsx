"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarPlusIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
  PhoneIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";

import type { Patient } from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";
import { usePatientCommunications } from "../_hooks/use-patient-communications";
import { usePatientDocuments } from "../_hooks/use-patient-documents";

export interface PatientRightRailProps {
  patient: Patient;
  appointments: PatientAppointment[];
  onOpenNewAppointmentDialog: () => void;
  className?: string;
}

function daysSince(at: string | null, nowMs: number): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / (24 * 60 * 60 * 1000)));
}

function frequencyKey(appts: PatientAppointment[]): string | null {
  const dates = appts
    .filter((a) => a.date)
    .map((a) => new Date(a.date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const span = dates[dates.length - 1] - dates[0];
  const avg = span / Math.max(1, dates.length - 1) / (24 * 60 * 60 * 1000);
  if (avg < 21) return "frequencyOften";
  if (avg < 45) return "frequencyMonth";
  if (avg < 100) return "frequencyQuarter";
  return "frequencyRare";
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_ICON: Record<string, LucideIcon> = {
  REFERRAL: FileTextIcon,
  PRESCRIPTION: FileTextIcon,
  RESULT: ImageIcon,
  CONSENT: FileTextIcon,
  CONTRACT: FileTextIcon,
  RECEIPT: FileTextIcon,
  OTHER: FileIcon,
};

export function PatientRightRail({
  patient,
  appointments,
  onOpenNewAppointmentDialog,
  className,
}: PatientRightRailProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("patientCard.rightRail");
  const [nowMs] = React.useState(() => Date.now());
  const commsQ = usePatientCommunications(patient.id);
  const docsQ = usePatientDocuments(patient.id);

  const comms = commsQ.data?.items ?? [];
  const docs = docsQ.data?.rows ?? [];

  const callsCount = comms.filter(
    (c) => c.kind === "call" || c.channel === "CALL",
  ).length;
  const tgCount = comms.filter((c) => c.channel === "TG").length;

  const since = daysSince(patient.lastVisitAt, nowMs);
  const noShow = appointments.filter((a) => a.status === "NO_SHOW").length;
  const noShowPct =
    appointments.length > 0
      ? Math.round((noShow / appointments.length) * 100)
      : 0;
  const riskKey =
    noShowPct === 0 ? "riskLow" : noShowPct < 15 ? "riskMedium" : "riskHigh";
  const risk = t(riskKey as never);
  const riskTone =
    noShowPct === 0
      ? "text-success"
      : noShowPct < 15
        ? "text-warning"
        : "text-destructive";

  const phoneHref = patient.phone
    ? `tel:${patient.phone.replace(/\s/g, "")}`
    : "#";

  const freqKey = frequencyKey(appointments);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Section title={t("quickActions")}>
        <div className="flex flex-col gap-2">
          <QuickAction
            icon={PhoneIcon}
            label={t("callPatient")}
            href={phoneHref}
          />
          {patient.telegramUsername || patient.telegramId ? (
            <QuickAction
              icon={SendIcon}
              label={t("writeTelegram")}
              href={`/${locale}/crm/telegram?patientId=${encodeURIComponent(patient.id)}`}
            />
          ) : (
            <QuickAction
              icon={SendIcon}
              label={t("writeTelegram")}
              disabled
            />
          )}
          <QuickAction
            icon={CalendarPlusIcon}
            label={t("createAppointment")}
            onClick={onOpenNewAppointmentDialog}
          />
        </div>
      </Section>

      <Section title={t("patientStatus")}>
        <StatusRow
          label={t("statusLabel")}
          value={
            <span className="inline-flex items-center rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              {t("statusActive")}
            </span>
          }
        />
        <StatusRow
          label={t("lastVisit")}
          value={since !== null ? t("daysAgo", { days: since }) : "—"}
        />
        <StatusRow
          label={t("visitFrequency")}
          value={freqKey ? t(freqKey as never) : "—"}
        />
        <StatusRow
          label={
            <span className="inline-flex items-center gap-1">
              {t("riskNoShow")}
              <InfoIcon className="size-3 text-muted-foreground" />
            </span>
          }
          value={<span className={cn("font-semibold", riskTone)}>{risk}</span>}
        />
      </Section>

      <Section
        title={t("communication")}
        action={
          <Link
            href={`/${locale}/crm/patients/${patient.id}?tab=communications`}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {t("more")}
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <CommTile icon={PhoneIcon} label={t("calls")} count={callsCount} />
          <CommTile icon={SendIcon} label="Telegram" count={tgCount} />
        </div>
      </Section>

      <Section
        title={t("files")}
        action={
          <Link
            href={`/${locale}/crm/documents?patientId=${encodeURIComponent(patient.id)}`}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {t("allFiles")}
          </Link>
        }
      >
        {docsQ.isLoading ? (
          <p className="text-[12px] text-muted-foreground">{t("loading")}</p>
        ) : docs.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {t("noDocuments")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {docs.slice(0, 4).map((d) => {
              const Icon = DOC_ICON[d.type] ?? FileIcon;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!d.fileUrl) return;
                      window.open(d.fileUrl, "_blank", "noopener,noreferrer");
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left text-[12px] transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {d.title}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
                        {formatDate(d.createdAt, locale, "short")}
                        {d.sizeBytes ? ` · ${formatBytes(d.sizeBytes)}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary";
  const content = (
    <>
      <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </span>
      <span>{label}</span>
    </>
  );
  if (disabled) {
    return (
      <span
        className={cn(
          base,
          "cursor-not-allowed opacity-50 hover:border-border hover:bg-background hover:text-foreground",
        )}
      >
        {content}
      </span>
    );
  }
  if (href) {
    return (
      <a href={href} className={base}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {content}
    </button>
  );
}

function StatusRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

function CommTile({
  icon: Icon,
  label,
  count,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-2.5">
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums text-foreground">
        {count}
      </span>
    </div>
  );
}
