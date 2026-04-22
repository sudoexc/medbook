"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlusIcon, CalendarXIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { SkeletonRow } from "@/components/atoms/skeleton-row";
import { TagChip } from "@/components/atoms/tag-chip";

import type { Patient } from "../../_hooks/use-patient";
import {
  usePatientAppointments,
  type PatientAppointment,
} from "../../_hooks/use-patient-appointments";

const STATUS_TONE: Record<
  string,
  "primary" | "info" | "warning" | "success" | "neutral"
> = {
  BOOKED: "info",
  WAITING: "warning",
  IN_PROGRESS: "primary",
  COMPLETED: "success",
  SKIPPED: "warning",
  CANCELLED: "neutral",
  NO_SHOW: "warning",
};

export interface VisitsTabProps {
  patient: Patient;
  onCreate: () => void;
}

export function VisitsTab({ patient, onCreate }: VisitsTabProps) {
  const t = useTranslations("patientCard.visits");
  const tStatus = useTranslations("appointment.status");
  const locale = useLocale() as Locale;

  const q = usePatientAppointments(patient.id);
  const rows = q.data?.rows ?? [];

  if (q.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} cols={5} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CalendarXIcon />}
        title={t("empty")}
        description={t("emptyDescription")}
        action={
          <Button onClick={onCreate}>
            <CalendarPlusIcon className="size-4" />
            {t("add")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t("count", { count: q.data?.total ?? rows.length })}
        </span>
        <Button size="sm" onClick={onCreate}>
          <CalendarPlusIcon className="size-4" />
          {t("add")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[130px_minmax(160px,1.5fr)_minmax(160px,2fr)_120px_140px] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("date")}</span>
          <span>{t("doctor")}</span>
          <span>{t("services")}</span>
          <span>{t("status")}</span>
          <span>{t("payment")}</span>
        </div>
        <div>
          {rows.map((row) => (
            <VisitRow
              key={row.id}
              row={row}
              locale={locale}
              statusLabel={(s) => {
                const key = s.toLowerCase() as
                  | "booked"
                  | "waiting"
                  | "inprogress"
                  | "completed"
                  | "skipped"
                  | "cancelled"
                  | "noshow";
                // next-intl schema uses "inProgress" and "noShow"
                const normalised =
                  key === "inprogress"
                    ? "inProgress"
                    : key === "noshow"
                      ? "noShow"
                      : key;
                return tStatus(
                  normalised as
                    | "booked"
                    | "waiting"
                    | "inProgress"
                    | "completed"
                    | "skipped"
                    | "cancelled"
                    | "noShow",
                );
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VisitRow({
  row,
  locale,
  statusLabel,
}: {
  row: PatientAppointment;
  locale: Locale;
  statusLabel: (s: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const serviceNames = [
    row.primaryService
      ? locale === "uz"
        ? row.primaryService.nameUz
        : row.primaryService.nameRu
      : null,
    ...row.services.map((s) =>
      locale === "uz" ? s.service.nameUz : s.service.nameRu,
    ),
  ].filter((x): x is string => Boolean(x));
  const doctorName = locale === "uz" ? row.doctor.nameUz : row.doctor.nameRu;
  const paid = row.payments.some((p) => p.status === "PAID");
  const hasPayment = row.payments.length > 0;
  const tone = STATUS_TONE[row.status] ?? "neutral";

  return (
    <div
      className={cn(
        "border-b border-border last:border-b-0 transition-colors",
        open && "bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[130px_minmax(160px,1.5fr)_minmax(160px,2fr)_120px_140px] items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
      >
        <div className="tabular-nums text-foreground">
          {formatDate(row.date, locale, "short")}
          {row.time ? (
            <span className="ml-1 text-xs text-muted-foreground">
              {row.time}
            </span>
          ) : null}
        </div>
        <div className="truncate text-foreground">{doctorName}</div>
        <div className="truncate text-muted-foreground">
          {serviceNames.length > 0 ? serviceNames.join(", ") : "—"}
        </div>
        <div>
          <TagChip color={tone} label={statusLabel(row.status)} />
        </div>
        <div>
          {row.priceFinal !== null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                paid ? "text-foreground" : "text-destructive",
              )}
            >
              <MoneyText amount={row.priceFinal} currency="UZS" />
              {hasPayment && !paid ? (
                <span className="text-xs">(долг)</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </button>
      {open ? (
        <div className="border-t border-border bg-card px-4 py-3 text-sm">
          {row.comments ? (
            <div className="mb-2">
              <div className="text-xs font-medium text-muted-foreground">
                {/* re-uses tVisits("comment") via prop would be overkill; inline */}
                Комментарий
              </div>
              <div className="text-foreground">{row.comments}</div>
            </div>
          ) : null}
          {row.notes ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Заметка врача
              </div>
              <div className="text-foreground">{row.notes}</div>
            </div>
          ) : null}
          {!row.comments && !row.notes ? (
            <div className="text-muted-foreground">Нет дополнительных данных.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
