"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ListOrderedIcon,
  PrinterIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { TicketPrintFrame } from "@/components/ticket/ticket-print-frame";
import { useReorderQueue } from "@/app/[locale]/crm/appointments/_hooks/use-appointment";
import type { TabletApptRow } from "@/lib/reception-tablet/doctor-day";
import {
  arrivedBookingsOf,
  liveQueueOf,
  moveId,
  tapOrderToIds,
  toggleTap,
} from "@/lib/reception-tablet/queue-order";

import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { doctorName } from "./doctor-tile";
import { BottomBar, TOUCH, TouchButton } from "./tablet-ui";

/**
 * «Очередь» on the reception tablet (owner request 08.10.2026): each
 * doctor's live queue in order, a reprint for anyone in it, arrows to move
 * someone a place, and «Расставить по порядку» for the crowd: she taps the
 * people in the order she calls them out («ты первая, ты вторая…») and
 * saves it once. The order goes through the desk's own reorder mutation,
 * so the desk, the doctor's TV and this screen show the same queue; «Срочно»
 * rows stay on top as everywhere else.
 */
export function QueueScreen({
  rows,
  doctors,
  online,
  onBack,
}: {
  rows: ReadonlyArray<TabletApptRow>;
  /** Doctors in the home screen's order. */
  doctors: ReadonlyArray<TabletDoctor>;
  online: boolean;
  onBack: () => void;
}) {
  const t = useTranslations("receptionTablet.queue");
  const locale = useLocale();
  const reorder = useReorderQueue();

  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const d of doctors) m.set(d.id, liveQueueOf(rows, d.id).length + arrivedBookingsOf(rows, d.id).length);
    return m;
  }, [rows, doctors]);

  // Opens on the first doctor somebody is waiting for.
  const [doctorId, setDoctorId] = React.useState<string | null>(
    () => doctors.find((d) => (counts.get(d.id) ?? 0) > 0)?.id ?? doctors[0]?.id ?? null,
  );
  const doctor = doctors.find((d) => d.id === doctorId) ?? doctors[0] ?? null;

  const live = React.useMemo(() => (doctor ? liveQueueOf(rows, doctor.id) : []), [rows, doctor]);
  const arrived = React.useMemo(
    () => (doctor ? arrivedBookingsOf(rows, doctor.id) : []),
    [rows, doctor],
  );
  const liveIds = React.useMemo(() => live.map((r) => r.id), [live]);

  // «Расставить по порядку»: the ids she tapped, in tap order.
  const [arranging, setArranging] = React.useState(false);
  const [tapped, setTapped] = React.useState<string[]>([]);
  React.useEffect(() => {
    setArranging(false);
    setTapped([]);
  }, [doctor?.id]);

  // One print at a time, tied to the row it was pressed for.
  const [print, setPrint] = React.useState<{ id: string; n: number } | null>(null);
  const reprint = (id: string) =>
    setPrint((p) => ({ id, n: p?.id === id ? p.n + 1 : (p?.n ?? 0) + 1 }));

  const busy = reorder.isPending;
  const save = (orderedIds: string[], after?: () => void) => {
    if (!doctor || busy || orderedIds.length < 2) {
      after?.();
      return;
    }
    reorder.mutate({ doctorId: doctor.id, orderedIds }, { onSettled: after });
  };

  const ticketOf = (r: TabletApptRow) =>
    (doctor && ticketNumberFor(doctor, r.ticketSeq ?? r.queueOrder)) ?? "—";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card px-6 py-3">
        <TouchButton tone="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeftIcon />
          {t("back")}
        </TouchButton>
        <h1 className="mr-auto text-2xl font-bold text-foreground">{t("title")}</h1>
        {!arranging && live.length > 1 ? (
          <TouchButton tone="outline" size="lg" onClick={() => setArranging(true)} disabled={!online}>
            <ListOrderedIcon />
            {t("arrange")}
          </TouchButton>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        {/* Doctors: big chips, wrapping; the tablet has no dropdowns. */}
        <div role="radiogroup" aria-label={t("doctors")} className="mb-5 flex flex-wrap gap-2.5">
          {doctors.map((d) => {
            const active = d.id === doctor?.id;
            const n = counts.get(d.id) ?? 0;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={arranging || busy}
                onClick={() => setDoctorId(d.id)}
                className={cn(
                  TOUCH,
                  "flex h-14 items-center gap-2 rounded-2xl border px-4 text-[17px] font-semibold transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground active:bg-muted",
                )}
              >
                {d.ticketPrefix ? <span className="font-mono font-bold">{d.ticketPrefix}</span> : null}
                <span className="max-w-[14rem] truncate">{doctorName(d, locale)}</span>
                <span
                  className={cn(
                    "rounded-full px-2 text-[15px] font-bold tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {arranging ? (
          <p className="mb-4 rounded-2xl bg-primary-soft px-5 py-4 text-[17px] font-medium text-primary dark:bg-primary/20">
            {t("arrangeHint")}
          </p>
        ) : null}

        {live.length === 0 && arrived.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <p className="text-xl font-semibold text-foreground">{t("empty")}</p>
          </div>
        ) : null}

        {live.length > 0 ? (
          <section aria-label={t("liveTitle")} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold uppercase tracking-wide text-muted-foreground">
              {t("liveTitle")}
            </h2>
            {live.map((r, i) => {
              const tapIndex = tapped.indexOf(r.id);
              const urgent = r.queuePriority > 0;
              const row = (
                <>
                  <span
                    className={cn(
                      "flex size-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold tabular-nums",
                      arranging
                        ? tapIndex >= 0
                          ? "bg-primary text-primary-foreground"
                          : "border-2 border-dashed border-border text-muted-foreground"
                        : i === 0
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                    )}
                    aria-label={t("place", { place: arranging ? tapIndex + 1 : i + 1 })}
                  >
                    {arranging ? (tapIndex >= 0 ? tapIndex + 1 : "") : i + 1}
                  </span>
                  <span className="w-32 shrink-0 font-mono text-3xl font-bold tabular-nums text-foreground">
                    {ticketOf(r)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xl font-semibold text-foreground">
                      {r.patient.fullName}
                    </span>
                    {urgent ? (
                      <span className="text-[15px] font-semibold text-destructive">{t("urgent")}</span>
                    ) : null}
                  </span>
                </>
              );
              return arranging ? (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={tapIndex >= 0}
                  onClick={() => setTapped((cur) => toggleTap(cur, r.id))}
                  className={cn(
                    TOUCH,
                    "flex min-h-20 items-center gap-4 rounded-3xl border-2 bg-card px-4 py-3 text-left transition-colors",
                    tapIndex >= 0 ? "border-primary" : "border-border active:bg-muted",
                  )}
                >
                  {row}
                </button>
              ) : (
                <div
                  key={r.id}
                  className="flex min-h-20 items-center gap-4 rounded-3xl border border-border bg-card px-4 py-3"
                >
                  {row}
                  <div className="flex shrink-0 items-center gap-2">
                    <TouchButton
                      tone="outline"
                      aria-label={t("up")}
                      disabled={!online || busy || i === 0}
                      onClick={() => {
                        const next = moveId(liveIds, r.id, -1);
                        if (next) save(next);
                      }}
                    >
                      <ArrowUpIcon />
                    </TouchButton>
                    <TouchButton
                      tone="outline"
                      aria-label={t("down")}
                      disabled={!online || busy || i === live.length - 1}
                      onClick={() => {
                        const next = moveId(liveIds, r.id, 1);
                        if (next) save(next);
                      }}
                    >
                      <ArrowDownIcon />
                    </TouchButton>
                    <TouchButton tone="outline" onClick={() => reprint(r.id)}>
                      <PrinterIcon />
                      {t("print")}
                    </TouchButton>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {arrived.length > 0 && !arranging ? (
          <section aria-label={t("arrivedTitle")} className="mt-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold uppercase tracking-wide text-muted-foreground">
              {t("arrivedTitle")}
            </h2>
            {arrived.map((r) => (
              <div
                key={r.id}
                className="flex min-h-20 items-center gap-4 rounded-3xl border border-border bg-card px-4 py-3"
              >
                <span className="w-32 shrink-0 font-mono text-3xl font-bold tabular-nums text-foreground">
                  {r.time ?? ticketOf(r)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">
                  {r.patient.fullName}
                </span>
                <TouchButton tone="outline" onClick={() => reprint(r.id)}>
                  <PrinterIcon />
                  {t("print")}
                </TouchButton>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {arranging ? (
        <BottomBar>
          <div className="flex gap-4">
            <TouchButton
              tone="outline"
              size="xl"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setArranging(false);
                setTapped([]);
              }}
            >
              <XIcon />
              {t("cancel")}
            </TouchButton>
            <TouchButton
              size="xl"
              className="flex-[2]"
              disabled={busy || !online || tapped.length === 0}
              onClick={() =>
                save(tapOrderToIds(liveIds, tapped), () => {
                  setArranging(false);
                  setTapped([]);
                })
              }
            >
              <CheckIcon />
              {busy ? t("saving") : t("save", { count: tapped.length })}
            </TouchButton>
          </div>
        </BottomBar>
      ) : null}

      {print ? <TicketPrintFrame appointmentId={print.id} job={print.n} /> : null}
    </div>
  );
}
