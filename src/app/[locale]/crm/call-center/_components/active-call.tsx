"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarPlusIcon,
  ExternalLinkIcon,
  HistoryIcon,
  UserPlusIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CountUp, useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";
import { usePatient } from "../../patients/[id]/_hooks/use-patient";

import type { CallRow } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";
import { useCallNotes } from "../_hooks/use-call-notes";

/**
 * Center column — caller context.
 *
 * Top: caller / patient header with live timer.
 * Body (when linked patient): LTV KPI row, next-appointment panel, big
 * booking CTA, visit-history list, notes textarea.
 * Body (anonymous): CTA to create a new patient card + notes textarea only —
 * everything else depends on a linked Patient row.
 *
 * Call controls, mute/hold/transfer, SMS, AI hints and scripts live in the
 * right rail (see `call-actions-rail.tsx`).
 */
export function ActiveCall({ call }: { call: CallRow | null }) {
  const t = useTranslations("callCenter.active");
  const tStatus = useTranslations("callCenter.status");
  const locale = useLocale() as Locale;

  const notes = useCallNotes(call);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (!call) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-2">
          <h2 className="text-base font-semibold">{t("empty.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
        </div>
      </div>
    );
  }

  const status = deriveStatus(call);
  const phone = call.direction === "OUT" ? call.toNumber : call.fromNumber;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <CallerHeader
        call={call}
        status={status}
        statusLabel={tStatus(status)}
        phone={phone}
        directionLabel={t(
          call.direction === "OUT" ? "direction.out" : "direction.in",
        )}
        anonymousLabel={t("anonymous")}
        openPatientLabel={t("openPatient")}
      />

      {call.patient ? (
        <PatientBody
          patientId={call.patient.id}
          locale={locale}
          onBook={() => setDialogOpen(true)}
        />
      ) : (
        <AnonymousBody
          phone={phone}
          createLabel={t("anonymousCtas.createPatient")}
          bookLabel={t("anonymousCtas.book")}
          onBook={() => setDialogOpen(true)}
          description={t("anonymousCtas.description")}
        />
      )}

      {/* ── Notes ──────────────────────────────────────────────────────── */}
      <section aria-label={t("notes.ariaLabel")} className="mt-6">
        <Label
          htmlFor="call-notes"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          {t("notes.label")}
        </Label>
        <Textarea
          id="call-notes"
          value={notes.value}
          onChange={(e) => notes.setValue(e.target.value)}
          onBlur={notes.flush}
          rows={4}
          placeholder={t("notes.placeholder")}
          className="mt-1 resize-none"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {notes.isSaving ? t("notes.saving") : t("notes.hint")}
        </p>
      </section>

      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={call.patient?.id ?? null}
        initialPatientPhone={call.patient ? null : phone}
      />
    </div>
  );
}

function CallerHeader({
  call,
  status,
  statusLabel,
  phone,
  directionLabel,
  anonymousLabel,
  openPatientLabel,
}: {
  call: CallRow;
  status: string;
  statusLabel: string;
  phone: string;
  directionLabel: string;
  anonymousLabel: string;
  openPatientLabel: string;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-border pb-4">
      <AvatarWithStatus
        name={call.patient?.fullName ?? anonymousLabel}
        size="lg"
        status={status === "answered" ? "online" : "offline"}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>{directionLabel}</span>
          <span aria-hidden>·</span>
          <StatusPill status={status} label={statusLabel} />
        </div>
        <h2 className="truncate text-xl font-semibold">
          {call.patient?.fullName ?? anonymousLabel}
        </h2>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">{formatPhone(phone)}</span>
          <LiveTimer startedAt={call.createdAt} endedAt={call.endedAt} />
        </div>
        {call.patient ? (
          <Link
            href={`/crm/patients/${call.patient.id}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {openPatientLabel}
            <ExternalLinkIcon className="size-3" />
          </Link>
        ) : null}
      </div>
    </header>
  );
}

function PatientBody({
  patientId,
  locale,
  onBook,
}: {
  patientId: string;
  locale: Locale;
  onBook: () => void;
}) {
  const t = useTranslations("callCenter.active");
  const query = usePatient(patientId);

  const p = query.data;
  const appointments = p?.appointments ?? [];
  const past = appointments.filter(
    (a) => a.status === "COMPLETED" || a.status === "NO_SHOW",
  );
  const upcoming = appointments.find(
    (a) => a.status === "BOOKED" || a.status === "WAITING",
  );
  const avgCheck =
    past.length > 0
      ? Math.round(
          past.reduce((acc, a) => acc + (a.priceFinal ?? 0), 0) / past.length,
        )
      : 0;

  const animatedLtv = useCountUp(p?.ltv ?? 0);
  const animatedAvgCheck = useCountUp(avgCheck);
  const animatedBalance = useCountUp(p?.balance ?? 0);

  if (query.isLoading) {
    return (
      <div className="mt-4 space-y-3">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!p) {
    return (
      <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {t("patientFetchError")}
      </div>
    );
  }

  return (
    <>
      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <section
        aria-label={t("kpi.ariaLabel")}
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        <KpiCard
          label={t("kpi.ltv")}
          value={
            <MoneyText
              amount={Math.round(animatedLtv)}
              currency="UZS"
              className="text-lg font-bold"
            />
          }
        />
        <KpiCard
          label={t("kpi.visits")}
          value={
            <CountUp
              to={p.visitsCount}
              className="text-lg font-bold tabular-nums"
            />
          }
        />
        <KpiCard
          label={t("kpi.avgCheck")}
          value={
            avgCheck > 0 ? (
              <MoneyText
                amount={Math.round(animatedAvgCheck)}
                currency="UZS"
                className="text-lg font-bold"
              />
            ) : (
              <span className="text-lg font-bold">—</span>
            )
          }
        />
        <KpiCard
          label={t("kpi.balance")}
          value={
            <MoneyText
              amount={Math.round(animatedBalance)}
              currency="UZS"
              className={cn(
                "text-lg font-bold",
                p.balance < 0 ? "text-destructive" : undefined,
              )}
            />
          }
        />
      </section>

      {/* ── Next appointment panel ─────────────────────────────────── */}
      <section
        aria-label={t("nextAppointment.ariaLabel")}
        className="mt-3 rounded-xl border border-border bg-card p-3"
      >
        <header className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("nextAppointment.title")}
          </h3>
        </header>
        {upcoming ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {locale === "uz"
                  ? upcoming.doctor.nameUz
                  : upcoming.doctor.nameRu}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {formatDate(upcoming.date, locale, "long")}
                {upcoming.time ? ` · ${upcoming.time}` : null}
                {upcoming.primaryService ? (
                  <>
                    {" · "}
                    {locale === "uz"
                      ? upcoming.primaryService.nameUz
                      : upcoming.primaryService.nameRu}
                  </>
                ) : null}
              </div>
            </div>
            <Link
              href={`/crm/appointments/${upcoming.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("nextAppointment.open")}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("nextAppointment.empty")}
          </p>
        )}
      </section>

      {/* ── Booking CTA ────────────────────────────────────────────── */}
      <Button
        type="button"
        size="lg"
        onClick={onBook}
        className="mt-3 w-full justify-center text-sm font-semibold tracking-wide"
      >
        <CalendarPlusIcon className="size-4" />
        {t("bookCta")}
      </Button>

      {/* ── Visit history ──────────────────────────────────────────── */}
      <section
        aria-label={t("visitHistory.ariaLabel")}
        className="mt-4 rounded-xl border border-border bg-card p-3"
      >
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-semibold">
              {t("visitHistory.title")}
            </h3>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {past.length}
          </span>
        </header>
        {past.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t("visitHistory.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {past.slice(0, 8).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {locale === "uz" ? a.doctor.nameUz : a.doctor.nameRu}
                    {a.primaryService ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {locale === "uz"
                          ? a.primaryService.nameUz
                          : a.primaryService.nameRu}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {formatDate(a.date, locale, "short")}
                    {a.time ? ` · ${a.time}` : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <MoneyText
                    amount={a.priceFinal ?? 0}
                    currency="UZS"
                    className="text-sm font-semibold tabular-nums"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AnonymousBody({
  phone,
  createLabel,
  bookLabel,
  description,
  onBook,
}: {
  phone: string;
  createLabel: string;
  bookLabel: string;
  description: string;
  onBook: () => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/crm/patients?new=true&phone=${encodeURIComponent(phone)}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <UserPlusIcon className="size-4" />
          {createLabel}
        </Link>
        <Button type="button" onClick={onBook}>
          <CalendarPlusIcon className="size-4" />
          {bookLabel}
        </Button>
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-foreground">{value}</div>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const cls =
    status === "ringing"
      ? "bg-primary/15 text-primary"
      : status === "answered"
        ? "bg-success/15 text-success"
        : status === "missed"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}
    >
      {label}
    </span>
  );
}

function LiveTimer({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  endedAt: string | null;
}) {
  const start = React.useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const end = React.useMemo(
    () => (endedAt ? new Date(endedAt).getTime() : null),
    [endedAt],
  );
  const [now, setNow] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    if (end != null) {
      setNow(end);
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end]);

  const refNow = end ?? now;
  const sec = Math.max(0, Math.round((refNow - start) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return (
    <span className="font-mono text-sm tabular-nums">
      {mm.toString().padStart(2, "0")}:{ss.toString().padStart(2, "0")}
    </span>
  );
}
