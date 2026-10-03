"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClockIcon, PencilIcon, UserRoundIcon, UsersIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCalendarDay } from "@/lib/format";
import { phoneTail } from "@/lib/reception-tablet/phone";
import { nameWithoutYear } from "@/lib/reception-tablet/new-patient";
import type { DoctorDaySummary } from "@/lib/reception-tablet/doctor-day";
import type { ActiveFlow, OwnerQuestion } from "@/lib/reception-tablet/flow";

import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { useDoctorServices } from "../_hooks/use-tablet-actions";
import { doctorName, useWaitText } from "./doctor-tile";
import { ServiceChips } from "./service-chips";
import { Caption, TicketLetter, TouchButton } from "./tablet-ui";

/** One line of the summary: what was chosen, and the way back to change it. */
function SummaryRow({
  icon,
  label,
  children,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  onChange?: () => void;
}) {
  const t = useTranslations("receptionTablet.flow");
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-6">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <Caption>{label}</Caption>
        <div className="mt-0.5">{children}</div>
      </div>
      {onChange ? (
        <TouchButton tone="ghost" onClick={onChange} aria-label={`${t("change")}: ${label}`}>
          <PencilIcon />
          {t("change")}
        </TouchButton>
      ) : null}
    </div>
  );
}

export function ConfirmStep({
  flow,
  doctor,
  summary,
  onGoTo,
  onService,
}: {
  flow: ActiveFlow;
  doctor: TabletDoctor | undefined;
  summary: DoctorDaySummary | undefined;
  onGoTo: (step: "patient" | "doctor" | "time") => void;
  onService: (serviceId: string | null) => void;
}) {
  const t = useTranslations("receptionTablet.confirm");
  const tPatient = useTranslations("receptionTablet.patient");
  const tTile = useTranslations("receptionTablet.tile");
  const tService = useTranslations("receptionTablet.service");
  const locale = useLocale();
  const waitText = useWaitText();
  const p = flow.patient;
  const tail = phoneTail(p?.phone);
  // The booking's service was picked with the slot; named here once more.
  const services = useDoctorServices(flow.mode === "book" ? flow.doctorId : null);
  const service = flow.serviceId
    ? services.data?.find((s) => s.id === flow.serviceId) ?? null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h2 className="text-[28px] font-bold leading-tight text-foreground">
        {flow.mode === "queue" ? t("titleQueue") : t("titleBook")}
      </h2>

      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
        <SummaryRow icon={<UserRoundIcon />} label={t("patient")} onChange={() => onGoTo("patient")}>
          <p className="truncate text-xl font-semibold text-foreground">
            {p ? nameWithoutYear(p.fullName) : ""}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[15px] text-muted-foreground">
            {p?.kind === "new" ? (
              <span className="rounded-full bg-primary/10 px-2 font-semibold text-primary">
                {t("newCard")}
              </span>
            ) : null}
            {p?.birthYear ? <span>{tPatient("born", { year: p.birthYear })}</span> : null}
            {tail ? <span className="tabular-nums">•• {tail}</span> : null}
          </p>
        </SummaryRow>

        <SummaryRow
          icon={doctor ? <TicketLetter letter={doctor.ticketPrefix} className="size-14" /> : <UsersIcon />}
          label={t("doctor")}
          onChange={() => onGoTo("doctor")}
        >
          <p className="truncate text-xl font-semibold text-foreground">
            {doctor ? doctorName(doctor, locale) : ""}
          </p>
          <p className="mt-0.5 text-[15px] text-muted-foreground">
            {[
              doctor?.cabinet ? tTile("cabinet", { number: doctor.cabinet.number }) : null,
              flow.mode === "queue" && summary
                ? `${t("queueNow", { count: summary.waiting })}, ${waitText(summary.waitMin)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </SummaryRow>

        {flow.mode === "book" && flow.day && flow.time ? (
          <SummaryRow icon={<CalendarClockIcon />} label={t("when")} onChange={() => onGoTo("time")}>
            <p className="text-xl font-semibold text-foreground">
              {formatCalendarDay(`${flow.day}T12:00:00+05:00`, locale, {
                month: "long",
                weekday: true,
              })}
              <span className="ml-2 tabular-nums">{flow.time}</span>
            </p>
            <p className="mt-0.5 text-[15px] text-muted-foreground">
              {service
                ? `${locale === "uz" ? service.nameUz || service.nameRu : service.nameRu} · ${tService("minutes", { min: service.durationMin })}`
                : tService("none")}
            </p>
          </SummaryRow>
        ) : null}
      </div>

      {/* Booking: the service was picked with the slot (it sizes it). */}
      {flow.mode === "queue" && flow.doctorId ? (
        <ServiceChips doctorId={flow.doctorId} value={flow.serviceId} onChange={onService} />
      ) : null}
    </div>
  );
}

/** «Этот номер уже записан на другого пациента»: the two answers, big. */
export function OwnerQuestionCard({
  owner,
  pending,
  onAnswer,
}: {
  owner: OwnerQuestion;
  pending: boolean;
  onAnswer: (answer: "same" | "other") => void;
}) {
  const t = useTranslations("patients.phoneOwner");
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-3xl border border-warning/50 bg-warning/10 p-6"
    >
      <p className="flex items-center gap-3 text-xl font-semibold text-foreground">
        <UsersIcon className="size-6 shrink-0" aria-hidden />
        {owner.unverified ? t("claimTitle") : t("title")}
      </p>
      <p className="text-[17px] text-foreground/80">
        {owner.unverified
          ? t("claimBody", { name: owner.fullName })
          : owner.birthYear !== null
            ? t("bodyWithYear", { name: owner.fullName, year: owner.birthYear })
            : t("body", { name: owner.fullName })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TouchButton tone="outline" size="lg" disabled={pending} onClick={() => onAnswer("same")}>
          {t("same")}
        </TouchButton>
        <TouchButton size="lg" disabled={pending} onClick={() => onAnswer("other")}>
          {t("other")}
        </TouchButton>
      </div>
      <p className={cn("text-[15px] text-muted-foreground")}>
        {owner.unverified ? t("claimOtherHint") : t("otherHint")}
      </p>
    </div>
  );
}
