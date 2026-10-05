"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  EyeIcon,
  FileTextIcon,
  HistoryIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SearchXIcon,
  UsersIcon,
} from "lucide-react";

import { useTranslations } from "next-intl";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { EmptyState } from "@/components/atoms/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  daysSinceLastVisit,
  isDoctorDormant,
} from "@/lib/doctor-patient-segments";
import { formatCalendarDay, formatDate } from "@/lib/format";
import { toast } from "sonner";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  flattenDoctorPatients,
  useMyPatients,
  type DoctorPatientRow,
} from "../_hooks/use-my-patients";

// Columns follow the table's own width (the section is a size container):
// six fixed tracks need about 800px, and on a 1366 screen with the side
// panels the table has about 730, so the name and diagnosis tracks shrank
// to nothing and the headers ran into each other (owner report 05.10.2026,
// the clinic's older monitors). Narrow: name, age, last visit, diagnosis,
// actions; from 680px the status joins; from 1000px phone and next visit.
const GRID =
  "grid grid-cols-[minmax(0,1.7fr)_56px_100px_minmax(0,1.4fr)_76px] gap-3 @min-[680px]:grid-cols-[minmax(0,1.7fr)_56px_100px_minmax(0,1.4fr)_110px_76px] @min-[1000px]:grid-cols-[minmax(0,1.7fr)_64px_150px_110px_minmax(0,1.4fr)_110px_140px_84px]";
// Dropped below 1000px (phone, next visit) and below 680px (status).
const WIDE = "hidden @min-[1000px]:block";
const WIDE_FLEX = "hidden @min-[1000px]:flex";
const MID = "hidden @min-[680px]:block";

// The month in the interface's language (audit UX-12).
function dateAndTime(iso: string, locale: string): { date: string; time: string } {
  return {
    date: formatCalendarDay(iso, locale, { year: true }),
    time: formatDate(iso, locale === "uz" ? "uz" : "ru", "time"),
  };
}

function ageFromBirth(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const monthDelta = now.getMonth() - b.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < b.getDate())) {
    years -= 1;
  }
  return years >= 0 ? years : null;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

type StatusTone = "active" | "watch" | "dormant";

function deriveStatus(row: DoctorPatientRow): {
  labelKey: string;
  tone: StatusTone;
} {
  if (row.hasActiveAppointment)
    return { labelKey: "table.status.inAppointment", tone: "active" };
  if (row.nextAppointmentWithMeAt)
    return { labelKey: "table.status.onWatch", tone: "watch" };
  if (!row.lastVisitWithMeAt)
    return { labelKey: "table.status.new", tone: "active" };
  // Nothing booked and past the «Давно не были» tab's own boundary (DC-26):
  // the badge and the tab come from one rule, so a row the «Вернулись» tab
  // lists never reads «Давно не был».
  if (isDoctorDormant(daysSinceLastVisit(row.lastVisitWithMeAt, Date.now()))) {
    return { labelKey: "table.status.dormant", tone: "dormant" };
  }
  return { labelKey: "table.status.onWatch", tone: "watch" };
}

const STATUS_BADGE: Record<StatusTone, string> = {
  active: "bg-success/15 text-success",
  watch: "bg-info/15 text-info",
  dormant: "bg-muted text-muted-foreground",
};

export function PatientsTable() {
  const t = useTranslations("doctor.patients");
  const { filters, selectedPatientId, setSelectedPatientId } =
    usePatientsFilters();
  const query = useMyPatients(filters);
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";

  const rows = flattenDoctorPatients(query.data);
  const isInitialLoading = query.isLoading;
  const isEmpty = !isInitialLoading && rows.length === 0;

  // Auto-select the top row so `SelectedPatientCard` shows something useful
  // when the page first loads. We only seed when there is no selection yet —
  // user picks via row click take precedence and survive re-renders.
  React.useEffect(() => {
    if (rows.length === 0) return;
    const present = rows.some((r) => r.id === selectedPatientId);
    if (!present) setSelectedPatientId(rows[0]!.id);
  }, [rows, selectedPatientId, setSelectedPatientId]);

  const openPatient = (id: string) => {
    setSelectedPatientId(id);
    router.push(`/${locale}/doctor/patients/${id}`);
  };

  const onWrite = async (id: string) => {
    try {
      const res = await fetch(
        "/api/crm/doctors/me/conversations/find-or-create",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId: id }),
        },
      );
      if (res.status === 422) {
        toast.error(t("toast.noChannel"), {
          description: t("toast.noChannelDescription"),
        });
        return;
      }
      if (!res.ok) {
        toast.error(t("toast.chatFailed"));
        return;
      }
      router.push(`/${locale}/doctor/messages?patientId=${id}`);
    } catch {
      toast.error(t("toast.chatFailed"));
    }
  };

  return (
    <section className="@container overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={cn(
          GRID,
          "border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div>{t("table.columns.patient")}</div>
        <div>{t("table.columns.age")}</div>
        <div className={WIDE}>{t("table.columns.phone")}</div>
        <div>{t("table.columns.lastVisit")}</div>
        <div>{t("table.columns.lastDiagnosis")}</div>
        <div className={MID}>{t("table.columns.status")}</div>
        <div className={WIDE}>{t("table.columns.nextAppointment")}</div>
        <div className="text-right">{t("table.columns.actions")}</div>
      </div>

      {isInitialLoading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {t("table.loading")}
        </div>
      ) : query.isError ? (
        <div className="px-5 py-10 text-center text-sm text-destructive">
          {t("table.loadError")}
        </div>
      ) : isEmpty ? (
        <div className="p-4">
          <EmptyState
            icon={filters.q ? <SearchXIcon /> : <UsersIcon />}
            title={filters.q ? t("table.emptySearch") : t("table.empty")}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => {
            const age = ageFromBirth(p.birthDate);
            const lastVisit = p.lastVisitWithMeAt
              ? dateAndTime(p.lastVisitWithMeAt, locale)
              : null;
            const nextAppt = p.nextAppointmentWithMeAt
              ? dateAndTime(p.nextAppointmentWithMeAt, locale)
              : null;
            const status = deriveStatus(p);

            const isSelected = selectedPatientId === p.id;
            return (
              <li
                key={p.id}
                role="link"
                tabIndex={0}
                onClick={() => openPatient(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPatient(p.id);
                  }
                }}
                className={cn(
                  GRID,
                  "cursor-pointer items-center px-5 py-3.5 transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none",
                  isSelected && "bg-primary/5",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <AvatarWithStatus
                    initials={initials(p.fullName)}
                    size="sm"
                    status={p.hasActiveAppointment ? "online" : undefined}
                  />
                  <span className="truncate text-sm font-semibold text-foreground">
                    {p.fullName}
                  </span>
                </div>

                <div className="text-sm text-foreground tabular-nums">
                  {age !== null ? t("table.ageShort", { age }) : "—"}
                </div>

                <div className={cn(WIDE_FLEX, "items-center gap-1.5 text-sm text-foreground tabular-nums")}>
                  <span>{p.phone}</span>
                  <PhoneIcon className="size-3.5 text-muted-foreground" />
                </div>

                <div className="min-w-0">
                  {lastVisit ? (
                    <>
                      <div className="text-sm font-medium text-foreground tabular-nums">
                        {lastVisit.date}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {lastVisit.time}
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>

                <div className="min-w-0">
                  {p.lastDiagnosisCode || p.lastDiagnosisName ? (
                    <span className="text-sm text-foreground">
                      {p.lastDiagnosisCode ? (
                        <span className="font-semibold tabular-nums">
                          {p.lastDiagnosisCode}{" "}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {p.lastDiagnosisName ?? ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>

                <div className={MID}>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold",
                      STATUS_BADGE[status.tone],
                    )}
                  >
                    {t(status.labelKey)}
                  </span>
                </div>

                <div className={cn(WIDE, "min-w-0 text-sm")}>
                  {nextAppt ? (
                    <>
                      <div className="font-medium text-foreground tabular-nums">
                        {nextAppt.date}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {nextAppt.time}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    aria-label={t("actions.write")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onWrite(p.id);
                    }}
                    className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MessageSquareIcon className="size-4" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("actions.moreActions")}
                        onClick={(e) => e.stopPropagation()}
                        className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedPatientId(p.id);
                          router.push(`/${locale}/doctor/patients/${p.id}`);
                        }}
                      >
                        <EyeIcon className="mr-2 size-4" />
                        {t("actions.openCard")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(
                            `/${locale}/doctor/patients/${p.id}?tab=visits`,
                          )
                        }
                      >
                        <HistoryIcon className="mr-2 size-4" />
                        {t("actions.visitHistory")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(
                            `/${locale}/doctor/patients/${p.id}?tab=documents`,
                          )
                        }
                      >
                        <FileTextIcon className="mr-2 size-4" />
                        {t("actions.documents")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
