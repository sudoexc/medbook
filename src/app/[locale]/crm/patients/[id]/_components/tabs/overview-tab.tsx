"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDaysIcon,
  CalendarIcon,
  ClipboardListIcon,
  InboxIcon,
  MessageCircleIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { KpiTile } from "@/components/atoms/kpi-tile";
import { MoneyText } from "@/components/atoms/money-text";

import type { Patient } from "../../_hooks/use-patient";
import {
  filterTimeline,
  usePatientCommunications,
} from "../../_hooks/use-patient-communications";
import { useDiagnoses, type DiagnosisRow } from "../../_hooks/use-patient-medical";
import { CommunicationsList } from "./communications-tab";

export interface OverviewTabProps {
  patient: Patient;
  onSwitchTab: (tab: string) => void;
}

export function OverviewTab({ patient, onSwitchTab }: OverviewTabProps) {
  const t = useTranslations("patientCard.overview");
  const tDx = useTranslations("patientCard.medical.diagnoses");
  const locale = useLocale() as Locale;
  const comms = usePatientCommunications(patient.id);
  const dx = useDiagnoses(patient.id);

  const recent = React.useMemo(
    () => filterTimeline(comms.data?.items, "ALL").slice(0, 10),
    [comms.data],
  );

  // Active diagnoses bubble up to the overview; resolved ones are a tail kept
  // only for the dedicated Medical tab. Six is enough to fit two rows on
  // typical viewports without forcing a scroll.
  const allDx = dx.data?.rows ?? [];
  const activeDx = React.useMemo<DiagnosisRow[]>(
    () => allDx.filter((d) => d.status === "ACTIVE"),
    [allDx],
  );
  const visibleDx = activeDx.slice(0, 6);
  const remainingDx = Math.max(0, activeDx.length - visibleDx.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          icon={<TrendingUpIcon />}
          label={t("ltv")}
          value={
            <MoneyText amount={patient.ltv} currency="UZS" />
          }
        />
        <KpiTile
          icon={<CalendarDaysIcon />}
          label={t("visitsCount")}
          value={patient.visitsCount}
        />
        <KpiTile
          icon={<CalendarIcon />}
          label={t("lastVisit")}
          value={
            patient.lastVisitAt
              ? formatDate(patient.lastVisitAt, locale, "short")
              : "—"
          }
        />
        <KpiTile
          icon={<CalendarIcon />}
          label={t("nextVisit")}
          value={
            patient.nextVisitAt
              ? formatDate(patient.nextVisitAt, locale, "short")
              : "—"
          }
        />
        {(() => {
          const lastContact = patient.lastContactedAt;
          const days = lastContact
            ? Math.round(
                (Date.now() - new Date(lastContact).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null;
          const tone: "neutral" | "warning" =
            days === null || days > 14 ? "warning" : "neutral";
          const subtitle =
            days === null
              ? undefined
              : days === 0
                ? t("lastContactToday")
                : t("lastContactDaysAgo", { days });
          return (
            <KpiTile
              icon={<MessageCircleIcon />}
              label={t("lastContact")}
              tone={tone}
              value={
                lastContact
                  ? formatDate(lastContact, locale, "short")
                  : t("lastContactNever")
              }
              subtitle={subtitle}
            />
          );
        })()}
        <KpiTile
          icon={<WalletIcon />}
          label={t("balance")}
          tone={
            patient.balance < 0
              ? "warning"
              : patient.balance > 0
                ? "success"
                : "neutral"
          }
          value={<MoneyText amount={patient.balance} currency="UZS" />}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {tDx("title")}
          </h3>
          <button
            type="button"
            onClick={() => onSwitchTab("medical")}
            className="text-xs text-primary hover:underline"
          >
            {t("viewAll")}
          </button>
        </div>
        {dx.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            …
          </div>
        ) : activeDx.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <ClipboardListIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{tDx("empty")}</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visibleDx.map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <ClipboardListIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {d.label}
                    </div>
                    {d.diagnosedAt ? (
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(d.diagnosedAt, locale, "short")}
                      </time>
                    ) : null}
                  </div>
                  {d.icd10Code || d.notes ? (
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {d.icd10Code ? (
                        <span className="font-mono">{d.icd10Code}</span>
                      ) : null}
                      {d.icd10Code && d.notes ? <span>·</span> : null}
                      {d.notes ? (
                        <span className="line-clamp-1">{d.notes}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
            {remainingDx > 0 ? (
              <li className="pt-2 text-xs text-muted-foreground">
                {t("diagnosesMore", { count: remainingDx })}
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t("recentActivity")}
          </h3>
          <button
            type="button"
            onClick={() => onSwitchTab("communications")}
            className="text-xs text-primary hover:underline"
          >
            {t("viewAll")}
          </button>
        </div>
        {comms.isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            …
          </div>
        ) : recent.length === 0 ? (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 py-8 text-center",
            )}
          >
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("noActivity")}
            </p>
          </div>
        ) : (
          <CommunicationsList items={recent} compact />
        )}
      </div>
    </div>
  );
}
