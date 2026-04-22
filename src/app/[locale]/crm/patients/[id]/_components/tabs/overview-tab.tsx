"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDaysIcon,
  CalendarIcon,
  InboxIcon,
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
import { CommunicationsList } from "./communications-tab";

export interface OverviewTabProps {
  patient: Patient;
  onSwitchTab: (tab: string) => void;
}

export function OverviewTab({ patient, onSwitchTab }: OverviewTabProps) {
  const t = useTranslations("patientCard.overview");
  const locale = useLocale() as Locale;
  const comms = usePatientCommunications(patient.id);

  const recent = React.useMemo(
    () => filterTimeline(comms.data?.items, "ALL").slice(0, 10),
    [comms.data],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
