"use client";

import { MessageSquareIcon, MoreHorizontalIcon, PhoneIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { cn } from "@/lib/utils";
import {
  MOCK_PATIENTS,
  type Patient,
  type RiskLevel,
} from "../_mocks";

const STATUS_BADGE: Record<Patient["status"]["tone"], string> = {
  active: "bg-success/15 text-success",
  watch: "bg-info/15 text-info",
  dormant: "bg-muted text-muted-foreground",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
};

const RISK_BADGE: Record<RiskLevel, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
};

const GRID =
  "grid grid-cols-[minmax(0,1.7fr)_64px_150px_110px_minmax(0,1.4fr)_110px_140px_100px_84px] gap-3";

export function PatientsTable() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div
        className={cn(
          GRID,
          "border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div>Пациент</div>
        <div>Возраст</div>
        <div>Телефон</div>
        <div>Последний визит</div>
        <div>Последний диагноз</div>
        <div>Статус</div>
        <div>Следующий приём</div>
        <div>Риск no-show</div>
        <div className="text-right">Действия</div>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-border">
        {MOCK_PATIENTS.map((p) => (
          <li
            key={p.id}
            className={cn(
              GRID,
              "items-center px-5 py-3.5 transition-colors hover:bg-muted/30",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <AvatarWithStatus
                initials={p.initials}
                size="sm"
                status={p.online ? "online" : undefined}
              />
              <span className="truncate text-sm font-semibold text-foreground">
                {p.fullName}
              </span>
            </div>

            <div className="text-sm text-foreground tabular-nums">{p.age} лет</div>

            <div className="flex items-center gap-1.5 text-sm text-foreground tabular-nums">
              <span>{p.phone}</span>
              <PhoneIcon className="size-3.5 text-muted-foreground" />
            </div>

            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground tabular-nums">
                {p.lastVisit.date}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {p.lastVisit.time}
              </div>
            </div>

            <div className="min-w-0">
              <span className="text-sm text-foreground">
                <span className="font-semibold tabular-nums">{p.lastDiagnosis.code}</span>{" "}
                <span className="text-muted-foreground">{p.lastDiagnosis.name}</span>
              </span>
            </div>

            <div>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold",
                  STATUS_BADGE[p.status.tone],
                )}
              >
                {p.status.label}
              </span>
            </div>

            <div className="min-w-0 text-sm">
              {p.nextAppointment ? (
                <>
                  <div className="font-medium text-foreground tabular-nums">
                    {p.nextAppointment.date}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {p.nextAppointment.time}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>

            <div>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold",
                  RISK_BADGE[p.risk],
                )}
              >
                {RISK_LABEL[p.risk]}
              </span>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label="Написать"
                className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MessageSquareIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Ещё действия"
                className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontalIcon className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
