"use client";

import * as React from "react";
import QRCode from "qrcode";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheckIcon, MapPinIcon, PrinterIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCalendarDay } from "@/lib/format";
import { queuePlace, type TabletApptRow } from "@/lib/reception-tablet/doctor-day";
import type { FlowResult } from "@/lib/reception-tablet/flow";

import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { doctorName } from "./doctor-tile";
import { TouchButton } from "./tablet-ui";
import { useTicketPrinter } from "@/components/ticket/use-ticket-printer";

/** The patient's live status page behind the slip's short code. */
function useTicketQr(ticketCode: string | null): string | null {
  const [qr, setQr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!ticketCode) return;
    let alive = true;
    // Same short link as the paper slip and the Mini App's ticket: /t/<code>
    // resolves to the signed status page of the visit (audit INF-10).
    QRCode.toDataURL(`${window.location.origin}/t/${ticketCode}`, { width: 512, margin: 1 })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [ticketCode]);
  return ticketCode ? qr : null;
}

export function TicketDone({
  result,
  doctor,
  rows,
  onNext,
}: {
  result: Extract<FlowResult, { kind: "ticket" }>;
  doctor: TabletDoctor | undefined;
  rows: TabletApptRow[];
  onNext: () => void;
}) {
  const t = useTranslations("receptionTablet.done");
  const locale = useLocale();
  const qr = useTicketQr(result.ticketCode);
  // Through the clinic's print agent when it runs (network printer, no
  // dialog), otherwise AirPrint from the hidden frame (09.10.2026).
  const printer = useTicketPrinter();
  const printing = printer.busy;

  // The live list knows the real place once it refreshes; until then, the
  // count of those waiting when the ticket was issued.
  const place = queuePlace(rows, result.appointmentId, result.doctorId);
  const ahead = place !== null ? place - 1 : result.placeHint;
  const cabinet = result.cabinet ?? doctor?.cabinet?.number ?? null;

  return (
    <div className="mx-auto grid w-full max-w-5xl items-center gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col items-center gap-6 text-center">
        <div>
          <h2 className="text-[28px] font-bold text-foreground">
            {result.duplicate ? t("duplicateTitle") : t("ticketTitle")}
          </h2>
          {result.duplicate ? (
            <p className="mt-1 text-[17px] text-muted-foreground">{t("duplicateHint")}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "w-full rounded-[2rem] border px-8 py-8",
            result.duplicate
              ? "border-warning/40 bg-warning/10"
              : "motion-success-pop border-success/30 bg-success/5",
          )}
        >
          <p className="text-[15px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("yourNumber")}
          </p>
          <p
            className={cn(
              "mt-2 font-mono text-[7rem] font-bold leading-none tracking-wider tabular-nums sm:text-[9rem]",
              result.duplicate ? "text-warning-text" : "text-success",
            )}
          >
            {result.ticketNumber}
          </p>
          <p className="mt-5 text-2xl font-semibold text-foreground">{result.patientName}</p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xl text-muted-foreground">
            {doctor ? <span>{doctorName(doctor, locale)}</span> : null}
            {cabinet ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <MapPinIcon className="size-5" aria-hidden />
                {t("cabinet", { number: cabinet })}
              </span>
            ) : null}
          </p>
          {ahead !== null ? (
            <p className="mt-5 inline-flex rounded-full bg-card px-5 py-2 text-xl font-semibold text-foreground ring-1 ring-border">
              {t("place", { ahead })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {qr ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL */}
            <img
              src={qr}
              alt=""
              width={256}
              height={256}
              className="size-64 rounded-3xl border border-border bg-white p-3"
            />
            <p className="max-w-xs text-center text-[17px] text-muted-foreground">{t("scan")}</p>
          </>
        ) : null}
        <TouchButton
          tone="outline"
          size="lg"
          className="w-full"
          onClick={() => {
            void printer.print(result.appointmentId);
          }}
          disabled={printing}
        >
          <PrinterIcon />
          {printing ? t("printing") : t("print")}
        </TouchButton>
        <TouchButton size="xl" className="w-full" onClick={onNext}>
          {t("next")}
        </TouchButton>
      </div>

      {printer.frame}
    </div>
  );
}

export function BookingDone({
  result,
  doctor,
  onNext,
}: {
  result: Extract<FlowResult, { kind: "booking" }>;
  doctor: TabletDoctor | undefined;
  onNext: () => void;
}) {
  const t = useTranslations("receptionTablet.done");
  const tTile = useTranslations("receptionTablet.tile");
  const locale = useLocale();
  const day = formatCalendarDay(`${result.day}T12:00:00+05:00`, locale, {
    month: "long",
    weekday: true,
  });
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      <span className="motion-success-pop flex size-24 items-center justify-center rounded-full bg-success/15 text-success">
        <CalendarCheckIcon className="size-12" aria-hidden />
      </span>
      <h2 className="text-[32px] font-bold text-foreground">{t("bookingTitle")}</h2>
      <div className="w-full rounded-[2rem] border border-success/30 bg-success/5 px-8 py-8">
        <p className="text-2xl font-semibold text-foreground">{result.patientName}</p>
        <p className="mt-4 text-[2.5rem] font-bold leading-tight tabular-nums text-foreground">
          {t("bookingWhen", { day, time: result.time })}
        </p>
        <p className="mt-3 text-xl text-muted-foreground">
          {[
            doctor ? doctorName(doctor, locale) : null,
            doctor?.cabinet ? tTile("cabinet", { number: doctor.cabinet.number }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {result.recovered ? (
        <p role="status" className="text-[17px] font-medium text-foreground">
          {t("bookingRecovered")}
        </p>
      ) : null}
      <p className="text-[17px] text-muted-foreground">{t("bookingHint")}</p>
      <TouchButton size="xl" className="w-full max-w-md" onClick={onNext}>
        {t("next")}
      </TouchButton>
    </div>
  );
}
