"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CalendarPlusIcon,
  PhoneIcon,
  RotateCcwIcon,
  StickyNoteIcon,
  XIcon,
  CheckIcon,
} from "lucide-react";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatClinicDateTime, formatPhone, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  LEAD_STATUSES,
  useOnlineRequests,
  useUpdateOnlineRequest,
  type LeadStatus,
  type OnlineRequestRow,
} from "../_hooks/use-online-requests";

type Tab = LeadStatus | "ALL";
const TABS: Tab[] = [...LEAD_STATUSES, "ALL"];

const STATUS_CHIP: Record<LeadStatus, string> = {
  NEW: "bg-warning/15 text-[color:var(--warning)]",
  CONTACTED: "bg-info/15 text-[color:var(--info)]",
  CONVERTED: "bg-success/15 text-[color:var(--success)]",
  CANCELLED: "bg-muted text-muted-foreground",
};

/** "2026-09-30T00:00:00.000Z" → "30.09.2026" (the form sends a bare day). */
function formatWantedDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : "";
}

/**
 * Pre-fill for the booking dialog: the day the visitor asked for, or today
 * when that day has already passed (the dialog cannot book into the past).
 */
function bookingDay(iso: string | null): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!iso) return today;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return today;
  const wanted = new Date(y, m - 1, d);
  return wanted < today ? today : wanted;
}

/**
 * «Заявки» — booking requests left on the public site (audit LD-01).
 *
 * The work queue of the desk / call center: NEW requests on top, a phone
 * link to call, and one button to book the person through the regular
 * appointment dialog. Booking passes `leadId`, so the server links the
 * request to the new visit and closes it as CONVERTED in one transaction.
 */
export function OnlineRequestsClient() {
  const t = useTranslations("onlineRequests");
  const locale = (useLocale() === "uz" ? "uz" : "ru") as Locale;
  const [tab, setTab] = React.useState<Tab>("NEW");
  const [converting, setConverting] = React.useState<OnlineRequestRow | null>(
    null,
  );

  // Memoised: the dialog resets its form whenever `initialDate` changes
  // identity, so a fresh Date per render would wipe what the operator typed.
  const convertDay = React.useMemo(
    () => (converting ? bookingDay(converting.date) : null),
    [converting],
  );

  const q = useOnlineRequests(tab);
  const update = useUpdateOnlineRequest();
  const tally = q.data?.tally;
  const rows = q.data?.rows ?? [];
  const forbidden =
    (q.error as (Error & { status?: number }) | null)?.status === 403;

  const setStatus = (row: OnlineRequestRow, status: LeadStatus) =>
    update.mutate(
      { id: row.id, status },
      {
        onSuccess: () => toast.success(t("toasts.updated")),
        onError: () => toast.error(t("toasts.updateError")),
      },
    );

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

      <div
        role="tablist"
        aria-label={t("title")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {TABS.map((key) => {
          const count =
            key === "ALL"
              ? tally
                ? Object.values(tally).reduce((a, b) => a + b, 0)
                : undefined
              : tally?.[key];
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {t(`tabs.${key}`)}
              {count !== undefined ? (
                <span
                  className={cn(
                    "rounded-md px-1.5 text-[10px] font-semibold tabular-nums",
                    key === "NEW" && count > 0
                      ? "bg-warning text-warning-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {forbidden ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("forbidden")}
        </p>
      ) : q.isError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {t("loadError")}
        </p>
      ) : q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {tab === "NEW" ? t("emptyNew") : t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <RequestRow
              key={row.id}
              row={row}
              locale={locale}
              busy={update.isPending && update.variables?.id === row.id}
              onBook={() => setConverting(row)}
              onStatus={(s) => setStatus(row, s)}
            />
          ))}
        </ul>
      )}

      <NewAppointmentDialog
        open={converting !== null}
        onOpenChange={(v) => {
          if (!v) setConverting(null);
        }}
        initialPatientPhone={converting?.phone ?? null}
        initialPatientName={converting?.name ?? null}
        initialDoctorId={converting?.doctorId ?? null}
        initialDate={convertDay}
        initialChannel="WEBSITE"
        leadId={converting?.id ?? null}
        onCreated={() => setConverting(null)}
      />
    </PageContainer>
  );
}

function RequestRow({
  row,
  locale,
  busy,
  onBook,
  onStatus,
}: {
  row: OnlineRequestRow;
  locale: Locale;
  busy: boolean;
  onBook: () => void;
  onStatus: (s: LeadStatus) => void;
}) {
  const t = useTranslations("onlineRequests");
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState(row.comment ?? "");
  const update = useUpdateOnlineRequest();

  const doctorName = row.doctor
    ? locale === "uz"
      ? row.doctor.nameUz || row.doctor.nameRu
      : row.doctor.nameRu
    : null;
  const open = row.status === "NEW" || row.status === "CONTACTED";

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        row.status === "NEW" ? "border-warning/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {row.name}
            </span>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                STATUS_CHIP[row.status],
              )}
            >
              {t(`tabs.${row.status}`)}
            </span>
            {row.source !== "WEBSITE" ? (
              <span className="text-[11px] text-muted-foreground">
                {t(`source.${row.source}` as never)}
              </span>
            ) : null}
          </div>
          <a
            href={`tel:${row.phone}`}
            className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <PhoneIcon className="size-3.5" />
            {formatPhone(row.phone)}
          </a>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
            <div>
              <dt className="inline">{t("fields.doctor")}: </dt>
              <dd className="inline text-foreground">
                {doctorName ?? t("fields.noDoctor")}
              </dd>
            </div>
            {row.date ? (
              <div>
                <dt className="inline">{t("fields.wantedDate")}: </dt>
                <dd className="inline text-foreground">
                  {formatWantedDay(row.date)}
                </dd>
              </div>
            ) : null}
            {row.service ? (
              <div>
                <dt className="inline">{t("fields.service")}: </dt>
                <dd className="inline text-foreground">{row.service}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("fields.receivedAt", {
              when: formatClinicDateTime(row.createdAt, locale),
            })}
          </p>
          {row.status === "CONVERTED" && row.appointment ? (
            <p className="mt-1 text-xs text-[color:var(--success)]">
              {t("fields.bookedFor", {
                when: formatClinicDateTime(row.appointment.date, locale),
              })}
              {row.patient ? (
                <>
                  {" · "}
                  <Link
                    href={`/${locale}/crm/patients/${row.patient.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {t("fields.openPatient")}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {row.comment && !noteOpen ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1 text-xs text-foreground">
              {row.comment}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {open ? (
            <Button size="sm" onClick={onBook} disabled={busy}>
              <CalendarPlusIcon />
              {t("actions.book")}
            </Button>
          ) : null}
          {row.status === "NEW" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("CONTACTED")}
              disabled={busy}
            >
              <CheckIcon />
              {t("actions.contacted")}
            </Button>
          ) : null}
          {open ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStatus("CANCELLED")}
              disabled={busy}
            >
              <XIcon />
              {t("actions.cancel")}
            </Button>
          ) : null}
          {row.status === "CANCELLED" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStatus("NEW")}
              disabled={busy}
            >
              <RotateCcwIcon />
              {t("actions.reopen")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNoteOpen((v) => !v)}
            aria-expanded={noteOpen}
          >
            <StickyNoteIcon />
            {t("actions.note")}
          </Button>
        </div>
      </div>

      {noteOpen ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("actions.notePlaceholder")}
            aria-label={t("actions.note")}
            rows={2}
            maxLength={5000}
          />
          <div>
            <Button
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { id: row.id, comment: note.trim() || null },
                  {
                    onSuccess: () => {
                      setNoteOpen(false);
                      toast.success(t("toasts.updated"));
                    },
                    onError: () => toast.error(t("toasts.updateError")),
                  },
                )
              }
            >
              {t("actions.saveNote")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
