"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { DateText } from "@/components/atoms/date-text";
import { MoneyText } from "@/components/atoms/money-text";
import { PhoneText } from "@/components/atoms/phone-text";
import { EmptyState } from "@/components/atoms/empty-state";

import {
  aggregatePatientsFromAppointments,
  useDoctorAppointments,
} from "../_hooks/use-doctor-appointments";
import { usePeriodRange, type PeriodKey } from "../../_hooks/use-doctors-filters";

export interface DoctorPatientsListProps {
  doctorId: string;
  className?: string;
}

const PERIODS: PeriodKey[] = ["month", "quarter"];

export function DoctorPatientsList({
  doctorId,
  className,
}: DoctorPatientsListProps) {
  const t = useTranslations("crmDoctors.patients");
  const tPeriod = useTranslations("crmDoctors.period");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<PeriodKey>("quarter");
  const range = usePeriodRange(period);

  const query = useDoctorAppointments(doctorId, range);
  const rows = query.data?.rows ?? [];

  const patients = React.useMemo(() => {
    const list = aggregatePatientsFromAppointments(rows);
    list.sort((a, b) => b.revenue - a.revenue);
    return list.slice(0, 30);
  }, [rows]);

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={
                p === period
                  ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {tPeriod(p)}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      ) : patients.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t("columns.name")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("columns.lastVisit")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("columns.visits")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("columns.ltv")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {patients.map((p) => (
                <tr key={p.patientId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/${locale}/crm/patients/${p.patientId}`}
                      className="flex min-w-0 items-center gap-2"
                      title={t("openCard")}
                    >
                      <AvatarWithStatus
                        src={p.photoUrl}
                        name={p.fullName}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {p.fullName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          <PhoneText phone={p.phone} asText />
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.lastVisitAt ? (
                      <DateText date={p.lastVisitAt} style="short" />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {p.visits}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MoneyText amount={p.revenue} currency="UZS" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
