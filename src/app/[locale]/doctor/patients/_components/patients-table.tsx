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
import { toast } from "sonner";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  flattenDoctorPatients,
  useMyPatients,
  type DoctorPatientRow,
} from "../_hooks/use-my-patients";

const GRID =
  "grid grid-cols-[minmax(0,1.7fr)_64px_150px_110px_minmax(0,1.4fr)_110px_140px_84px] gap-3";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function ruDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const day = d.getDate();
  const month = RU_MONTHS_SHORT[d.getMonth()] ?? "";
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date: `${day} ${month} ${year}`, time: `${hh}:${mm}` };
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
  // Visit was >90 days ago and nothing booked → давно не был.
  const last = new Date(row.lastVisitWithMeAt).getTime();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  if (Date.now() - last > ninetyDays) {
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
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={cn(
          GRID,
          "border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div>{t("table.columns.patient")}</div>
        <div>{t("table.columns.age")}</div>
        <div>{t("table.columns.phone")}</div>
        <div>{t("table.columns.lastVisit")}</div>
        <div>{t("table.columns.lastDiagnosis")}</div>
        <div>{t("table.columns.status")}</div>
        <div>{t("table.columns.nextAppointment")}</div>
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
              ? ruDate(p.lastVisitWithMeAt)
              : null;
            const nextAppt = p.nextAppointmentWithMeAt
              ? ruDate(p.nextAppointmentWithMeAt)
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

                <div className="flex items-center gap-1.5 text-sm text-foreground tabular-nums">
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

                <div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold",
                      STATUS_BADGE[status.tone],
                    )}
                  >
                    {t(status.labelKey)}
                  </span>
                </div>

                <div className="min-w-0 text-sm">
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
