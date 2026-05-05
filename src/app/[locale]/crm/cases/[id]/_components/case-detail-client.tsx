"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  PlusIcon,
  RefreshCwIcon,
  StethoscopeIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { PageContainer } from "@/components/molecules/page-container";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { SkeletonRow } from "@/components/atoms/skeleton-row";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import { InlineField } from "../../../patients/[id]/_components/inline-field";
import {
  type CaseAppointmentRow,
  type CaseDetail,
  type CaseStatus,
  useCase,
  useDetachAppointment,
  usePatchCase,
} from "../_hooks/use-case";
import { CloseCaseDialog } from "./close-case-dialog";

// ---------------------------------------------------------------------------
// Status badge variants — same mapping the patient-card "Cases" tab uses, so
// the visual story stays consistent across surfaces.
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<
  CaseStatus,
  "default" | "success" | "warning" | "muted"
> = {
  OPEN: "default",
  RESOLVED: "success",
  TRANSFERRED: "warning",
  ABANDONED: "muted",
};

const TERMINAL_STATUSES: CaseStatus[] = [
  "RESOLVED",
  "ABANDONED",
  "TRANSFERRED",
];

function statusKey(
  s: CaseStatus,
):
  | "statusOpen"
  | "statusResolved"
  | "statusAbandoned"
  | "statusTransferred" {
  switch (s) {
    case "OPEN":
      return "statusOpen";
    case "RESOLVED":
      return "statusResolved";
    case "ABANDONED":
      return "statusAbandoned";
    case "TRANSFERRED":
      return "statusTransferred";
  }
}

// ---------------------------------------------------------------------------
// Doctor list (for "сменить ведущего врача" dropdown). Fetched lazily — only
// when the dropdown opens — so the initial render doesn't pay for it.
// ---------------------------------------------------------------------------

type DoctorOption = {
  id: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string | null;
  specializationUz: string | null;
  photoUrl: string | null;
  isActive: boolean;
};

function useDoctorsForDropdown(open: boolean) {
  return useQuery<DoctorOption[], Error>({
    queryKey: ["doctors", "case-detail-dropdown"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
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

// ---------------------------------------------------------------------------
// Page client
// ---------------------------------------------------------------------------

export interface CaseDetailClientProps {
  id: string;
}

export function CaseDetailClient({ id }: CaseDetailClientProps) {
  const tRaw = useTranslations("cases.detail");
  const tCasesRaw = useTranslations("patientCard.cases");
  const tStatusRaw = useTranslations("appointment.status");
  // next-intl's `useTranslations` typings carry the message-key union; cast
  // to a plain string-key signature so we can pass the function down to
  // generic helper components without polluting their props with the keys.
  const t = tRaw as unknown as (
    k: string,
    vars?: Record<string, string | number>,
  ) => string;
  const tCases = tCasesRaw as unknown as (
    k: string,
    vars?: Record<string, string | number>,
  ) => string;
  const tStatus = tStatusRaw as unknown as (
    k:
      | "booked"
      | "waiting"
      | "inProgress"
      | "completed"
      | "skipped"
      | "cancelled"
      | "noShow",
  ) => string;
  const locale = useLocale() as Locale;

  const q = useCase(id);
  const patch = usePatchCase(id);

  const [closeOpen, setCloseOpen] = React.useState(false);
  const [doctorMenuOpen, setDoctorMenuOpen] = React.useState(false);
  const [newApptOpen, setNewApptOpen] = React.useState(false);

  if (q.isLoading) {
    return (
      <PageContainer>
        <SkeletonRow cols={2} />
        <div className="rounded-xl border border-border bg-card p-6">
          <SkeletonRow cols={3} />
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} cols={4} />
          ))}
        </div>
      </PageContainer>
    );
  }

  if (q.isError) {
    const notFound = q.error.message === "NOT_FOUND";
    return (
      <PageContainer>
        <Link
          href={`/${locale}/crm/patients`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("breadcrumbsRoot")}
        </Link>
        <EmptyState
          icon={<ClipboardListIcon />}
          title={notFound ? t("notFound") : q.error.message}
          action={
            notFound ? (
              <Link
                href={`/${locale}/crm/patients`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                {t("notFoundBackToPatients")}
              </Link>
            ) : (
              <Button variant="outline" onClick={() => q.refetch()}>
                <RefreshCwIcon className="size-4" />
                {t("retry")}
              </Button>
            )
          }
        />
      </PageContainer>
    );
  }

  const data = q.data!;
  const isOpen = data.status === "OPEN";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer>
          {/* Breadcrumbs: Пациенты › <patient> › Случаи › <title> */}
          <nav
            aria-label={t("breadcrumbsRoot")}
            className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
          >
            <Link
              href={`/${locale}/crm/patients`}
              className="hover:text-foreground"
            >
              {t("breadcrumbsRoot")}
            </Link>
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <Link
              href={`/${locale}/crm/patients/${data.patient.id}`}
              className="truncate hover:text-foreground"
            >
              {data.patient.fullName}
            </Link>
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="text-foreground/80">{tCases("tabTitle")}</span>
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-medium text-foreground">
              {data.title}
            </span>
          </nav>

          {/* Header card: title + status + action buttons */}
          <header className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={STATUS_VARIANT[data.status]}>
                    {tCases(statusKey(data.status))}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {tCases("opened")}: {formatDate(data.openedAt, locale, "short")}
                    {data.closedAt ? (
                      <>
                        {" · "}
                        {tCases("closed")}: {formatDate(data.closedAt, locale, "short")}
                      </>
                    ) : null}
                  </span>
                </div>
                <InlineField
                  value={data.title}
                  display={
                    <span className="text-2xl font-semibold text-foreground">
                      {data.title}
                    </span>
                  }
                  onSave={async (next) => {
                    if (!next) return;
                    await patch.mutateAsync({ title: next });
                  }}
                  placeholder={t("titlePlaceholder")}
                  allowEmpty={false}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {/* Change primary doctor dropdown */}
                <ChangeDoctorMenu
                  open={doctorMenuOpen}
                  onOpenChange={setDoctorMenuOpen}
                  data={data}
                  locale={locale}
                  t={t}
                  onPick={async (doctorId) => {
                    await patch.mutateAsync({ primaryDoctorId: doctorId });
                    toast.success(t("doctorChanged"));
                    setDoctorMenuOpen(false);
                  }}
                />

                {isOpen ? (
                  <Button
                    onClick={() => setCloseOpen(true)}
                    disabled={patch.isPending}
                  >
                    {t("closeCase")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await patch.mutateAsync({ status: "OPEN" });
                      toast.success(t("reopened"));
                    }}
                    disabled={patch.isPending}
                  >
                    {t("reopenCase")}
                  </Button>
                )}
              </div>
            </div>
          </header>

          {/* Meta + body grid: meta card on left, timeline on right */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <CaseMetaCard data={data} locale={locale} t={t} patch={patch} />
            <CaseTimelineCard
              data={data}
              locale={locale}
              t={t}
              tCases={tCases}
              tStatus={tStatus}
              onAddVisit={() => setNewApptOpen(true)}
            />
          </div>
        </PageContainer>
      </div>

      {/* Right rail: stats + patient mini-card */}
      <aside className="hidden w-[300px] shrink-0 border-l border-border bg-muted/10 xl:flex xl:flex-col">
        <div className="flex flex-col gap-3 p-4">
          <CaseStatsCard data={data} t={t} />
          <PatientMiniCard data={data} locale={locale} t={t} />
        </div>
      </aside>

      <CloseCaseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onSubmit={async (status, reason) => {
          await patch.mutateAsync({
            status,
            closedReason: reason || null,
          });
          toast.success(t("closedSuccess"));
          setCloseOpen(false);
        }}
      />

      <NewAppointmentDialog
        open={newApptOpen}
        onOpenChange={setNewApptOpen}
        patientId={data.patient.id}
        initialDoctorId={data.primaryDoctorId ?? null}
        onCreated={async (appointmentId) => {
          // Auto-attach the freshly-created appointment to this case so the
          // user does not have to dig into the case selector again. The
          // selector dialog inside NewAppointmentDialog will skip the
          // "single open case" branch because we already attached.
          try {
            const res = await fetch(
              `/api/crm/cases/${data.id}/attach-appointment`,
              {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appointmentId }),
              },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await q.refetch();
          } catch (e) {
            toast.error(
              (e as Error).message || "Не удалось привязать запись к случаю",
            );
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header subcomponents
// ---------------------------------------------------------------------------

function ChangeDoctorMenu({
  open,
  onOpenChange,
  data,
  locale,
  t,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: CaseDetail;
  locale: Locale;
  t: (k: string) => string;
  onPick: (doctorId: string | null) => Promise<void>;
}) {
  const docsQ = useDoctorsForDropdown(open);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <StethoscopeIcon className="size-4" />
          {t("changeDoctor")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {docsQ.isLoading ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">…</div>
        ) : null}
        <DropdownMenuItem
          onClick={() => void onPick(null)}
          disabled={!data.primaryDoctorId}
        >
          <span className="text-muted-foreground">
            {t("noDoctorOption")}
          </span>
        </DropdownMenuItem>
        {(docsQ.data ?? []).map((d) => {
          const name = locale === "uz" ? d.nameUz : d.nameRu;
          const spec = locale === "uz" ? d.specializationUz : d.specializationRu;
          const active = d.id === data.primaryDoctorId;
          return (
            <DropdownMenuItem
              key={d.id}
              onClick={() => void onPick(d.id)}
              disabled={active}
            >
              <Avatar className="size-6">
                <AvatarImage src={d.photoUrl ?? undefined} alt={name} />
                <AvatarFallback className="text-[10px]">
                  {name
                    .split(" ")
                    .map((s) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{name}</span>
                {spec ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {spec}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Meta card (left column)
// ---------------------------------------------------------------------------

function CaseMetaCard({
  data,
  locale,
  t,
  patch,
}: {
  data: CaseDetail;
  locale: Locale;
  t: (k: string) => string;
  patch: ReturnType<typeof usePatchCase>;
}) {
  const doctor = data.primaryDoctor;
  const doctorName = doctor
    ? locale === "uz"
      ? doctor.nameUz
      : doctor.nameRu
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Primary doctor */}
      <div className="flex items-start gap-3">
        <Avatar className="size-9">
          <AvatarImage alt={doctorName ?? ""} />
          <AvatarFallback className="text-[11px]">
            {(doctorName ?? "?")
              .split(" ")
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("metaPrimaryDoctor")}
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {doctorName ?? t("noDoctorOption")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("metaOpenedAt")}
          </span>
          <span className="text-sm tabular-nums text-foreground">
            {formatDate(data.openedAt, locale, "short")}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("metaClosedAt")}
          </span>
          <span className="text-sm tabular-nums text-foreground">
            {data.closedAt ? formatDate(data.closedAt, locale, "short") : "—"}
          </span>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          {t("metaComplaint")}
        </span>
        <InlineField
          value={data.primaryComplaint ?? ""}
          display={
            data.primaryComplaint ? (
              <span className="whitespace-pre-line text-sm text-foreground">
                {data.primaryComplaint}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )
          }
          onSave={async (next) => {
            await patch.mutateAsync({ primaryComplaint: next ?? null });
          }}
          placeholder={t("metaComplaintPlaceholder")}
        />
      </div>

      <div className="border-t border-border pt-3">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          {t("metaDiagnosis")}
        </span>
        <InlineField
          value={data.diagnosisText ?? ""}
          display={
            data.diagnosisText ? (
              <span className="whitespace-pre-line text-sm text-foreground">
                {data.diagnosisText}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )
          }
          onSave={async (next) => {
            await patch.mutateAsync({ diagnosisText: next ?? null });
          }}
          placeholder={t("metaDiagnosisPlaceholder")}
        />
        <div className="mt-2">
          <InlineField
            label={t("metaDiagnosisCode")}
            value={data.diagnosisCode ?? ""}
            display={
              data.diagnosisCode ? (
                <span className="font-mono text-xs text-foreground">
                  {data.diagnosisCode}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )
            }
            onSave={async (next) => {
              await patch.mutateAsync({ diagnosisCode: next ?? null });
            }}
            placeholder="ICD-10"
          />
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          {t("metaNotes")}
        </span>
        <InlineField
          value={data.notes ?? ""}
          display={
            data.notes ? (
              <span className="whitespace-pre-line text-sm text-foreground">
                {data.notes}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )
          }
          onSave={async (next) => {
            await patch.mutateAsync({ notes: next ?? null });
          }}
          placeholder={t("metaNotesPlaceholder")}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Visits timeline (right column of the main grid)
// ---------------------------------------------------------------------------

const VISIT_STATUS_VARIANT: Record<
  CaseAppointmentRow["status"],
  "default" | "info" | "success" | "warning" | "muted" | "destructive"
> = {
  BOOKED: "info",
  WAITING: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  SKIPPED: "muted",
  CANCELLED: "destructive",
  NO_SHOW: "muted",
};

function statusI18nKey(
  s: CaseAppointmentRow["status"],
):
  | "booked"
  | "waiting"
  | "inProgress"
  | "completed"
  | "skipped"
  | "cancelled"
  | "noShow" {
  switch (s) {
    case "BOOKED":
      return "booked";
    case "WAITING":
      return "waiting";
    case "IN_PROGRESS":
      return "inProgress";
    case "COMPLETED":
      return "completed";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NO_SHOW":
      return "noShow";
  }
}

function CaseTimelineCard({
  data,
  locale,
  t,
  tCases,
  tStatus,
  onAddVisit,
}: {
  data: CaseDetail;
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
  tCases: (k: string, vars?: Record<string, string | number>) => string;
  tStatus: (
    k:
      | "booked"
      | "waiting"
      | "inProgress"
      | "completed"
      | "skipped"
      | "cancelled"
      | "noShow",
  ) => string;
  onAddVisit: () => void;
}) {
  const detach = useDetachAppointment(data.id, data.patientId);
  // Appointments come from the API in date-asc order. We render that order
  // verbatim ("first visit" is at the top, repeats below) so the
  // "N days after first" labels make intuitive sense to the doctor.
  const rows = data.appointments;
  const firstAtMs = rows[0]
    ? new Date(rows[0].date).getTime()
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t("timelineTitle")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {tCases("visits", { count: rows.length })}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("timelineEmpty")}
          action={
            <Button onClick={onAddVisit}>
              <PlusIcon className="size-4" />
              {t("timelineAddVisit")}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <VisitRow
              key={row.id}
              row={row}
              index={i}
              firstAtMs={firstAtMs}
              locale={locale}
              t={t}
              tStatus={tStatus}
              onDetach={async () => {
                await detach.mutateAsync({ appointmentId: row.id });
                toast.success(t("detached"));
              }}
              detachDisabled={detach.isPending}
            />
          ))}
        </ol>
      )}

      <Button
        variant="outline"
        onClick={onAddVisit}
        className="self-start"
      >
        <PlusIcon className="size-4" />
        {t("timelineAddVisit")}
      </Button>
    </section>
  );
}

function VisitRow({
  row,
  index,
  firstAtMs,
  locale,
  t,
  tStatus,
  onDetach,
  detachDisabled,
}: {
  row: CaseAppointmentRow;
  index: number;
  firstAtMs: number | null;
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
  tStatus: (
    k:
      | "booked"
      | "waiting"
      | "inProgress"
      | "completed"
      | "skipped"
      | "cancelled"
      | "noShow",
  ) => string;
  onDetach: () => Promise<void>;
  detachDisabled: boolean;
}) {
  const visitNumber = index + 1;
  const isFirst = visitNumber === 1;
  const doctorName = row.doctor
    ? locale === "uz"
      ? row.doctor.nameUz
      : row.doctor.nameRu
    : null;
  const serviceName = row.primaryService
    ? locale === "uz"
      ? row.primaryService.nameUz
      : row.primaryService.nameRu
    : null;

  const daysAfter = (() => {
    if (isFirst || firstAtMs === null) return null;
    const ms = new Date(row.date).getTime() - firstAtMs;
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
  })();

  const subtitle = isFirst
    ? t("firstVisit")
    : daysAfter !== null && daysAfter > 0
      ? `${t("repeatVisit")} (${t("daysAfterFirst", { n: daysAfter } as never)})`
      : t("repeatVisit");

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex shrink-0 items-center gap-2 sm:w-[140px]">
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold",
            isFirst
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          #{visitNumber}
        </span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatDate(row.date, locale, "short")}
            {row.time ? (
              <span className="ml-1 text-xs text-muted-foreground">
                {row.time}
              </span>
            ) : null}
          </span>
          <Badge variant={VISIT_STATUS_VARIANT[row.status]}>
            {tStatus(statusI18nKey(row.status))}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {doctorName ? <span>{doctorName}</span> : null}
          {serviceName ? <span>· {serviceName}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end">
        {row.priceFinal !== null ? (
          <span className="text-sm tabular-nums text-foreground">
            <MoneyText amount={row.priceFinal} currency="UZS" />
          </span>
        ) : null}
        <div className="flex items-center gap-1">
          <Link
            href={`/${locale}/crm/appointments?ap=${row.id}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-7 px-2 text-xs",
            )}
          >
            {t("openVisit")}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={detachDisabled}
            onClick={() => void onDetach()}
          >
            {t("timelineDetach")}
          </Button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Right rail: stats + patient mini card
// ---------------------------------------------------------------------------

function CaseStatsCard({
  data,
  t,
}: {
  data: CaseDetail;
  t: (k: string) => string;
}) {
  const stats = React.useMemo(() => {
    let totalPaid = 0;
    let freeRepeats = 0;
    for (const a of data.appointments) {
      if (a.priceFinal && a.priceFinal > 0) {
        // Heuristic: visits with priceFinal > 0 contribute to "paid" total.
        // Actual payment status lives on the appointment payments which the
        // detail endpoint does not include — we present this as billed.
        totalPaid += a.priceFinal;
      } else if (a.priceFinal === 0) {
        freeRepeats += 1;
      }
    }
    return { totalPaid, freeRepeats, totalVisits: data.appointments.length };
  }, [data.appointments]);

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("statsTitle")}
      </h3>
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t("statsTotalVisits")}</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {stats.totalVisits}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t("statsTotalPaid")}</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            <MoneyText amount={stats.totalPaid} currency="UZS" />
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t("statsFreeRepeats")}</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {stats.freeRepeats}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function PatientMiniCard({
  data,
  locale,
  t,
}: {
  data: CaseDetail;
  locale: Locale;
  t: (k: string) => string;
}) {
  const initials = data.patient.fullName
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Link
      href={`/${locale}/crm/patients/${data.patient.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-card/70"
    >
      <Avatar className="size-10">
        <AvatarFallback>{initials || <UserIcon className="size-4" />}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">
          {data.patient.fullName}
        </span>
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {formatPhone(data.patient.phone)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("openPatientCard")}
        </span>
      </div>
    </Link>
  );
}
