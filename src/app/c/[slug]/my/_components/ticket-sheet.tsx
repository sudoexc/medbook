"use client";

/**
 * Wave 3b — full-screen boarding-pass ticket (DESIGN-DOCTRINE П5/П9/П10).
 *
 * Opened from the home queue hero by swipe-up or tap. Top half: huge ticket
 * number + live queue position/ETA (same `useQueueStatus` cache the hero
 * polls, so numbers move in ≤2s via `queue.updated`). Bottom half, behind a
 * perforated divider: the `/t/<ticketCode>` QR the reception desk scans.
 * Closes by swipe-down, the X button, or the Telegram BackButton.
 */
import * as React from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";

import { useT, useLang } from "./mini-i18n";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useQueueStatus } from "../_hooks/use-queue-status";
import { type MiniAppAppointment } from "../_hooks/use-appointments";
import { formatTimeISO } from "./mini-ui";
import { MA_ACCENTS } from "./mini-app-tokens";

const GREEN = MA_ACCENTS.success;
const SALMON = MA_ACCENTS.salmon;

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function LiveDot({ color = GREEN }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span
        className="ma-ping absolute inline-flex h-full w-full rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function DetailCell({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--tg-hint)" }}
      >
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

export function TicketSheet({
  appt,
  onClose,
}: {
  appt: MiniAppAppointment;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  const q = useQueueStatus(appt.id);
  const [qr, setQr] = React.useState<string | null>(null);
  const [closing, setClosing] = React.useState(false);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);

  const requestClose = React.useCallback(() => setClosing(true), []);
  React.useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClose, 240);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  const ticketCode = appt.ticketCode;
  React.useEffect(() => {
    if (!ticketCode) return;
    const url = `${window.location.origin}/t/${ticketCode}`;
    QRCode.toDataURL(url, { width: 512, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [ticketCode]);

  React.useEffect(() => {
    const off = tg.setBackButton(requestClose);
    return off;
  }, [tg, requestClose]);

  const data = q.data;
  const waiting = data?.status === "WAITING";
  const inProgress = data?.status === "IN_PROGRESS";
  const live = waiting || inProgress;
  const ahead = data ? Math.max(0, (data.position ?? 1) - 1) : 0;
  const isNext = waiting && ahead === 0;
  const aheadTemplate =
    lang === "RU"
      ? ruPlural(
          ahead,
          t.home.hero.aheadOne,
          t.home.hero.aheadFew,
          t.home.hero.aheadMany,
        )
      : t.home.hero.aheadOne;
  const etaFlavor = data
    ? (data.etaMinutes ?? 0) <= 5
      ? t.home.hero.etaShort
      : (data.etaMinutes ?? 0) <= 25
        ? t.home.hero.etaMid
        : t.home.hero.etaLong
    : "";
  const doctorName = lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu;
  const cabinet = data?.cabinet ?? appt.cabinet?.number ?? "—";
  const time = appt.time ?? formatTimeISO(appt.date);
  const bigNumber = data?.ticketNumber ?? appt.ticketCode ?? "—";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t.ticket.title}
      className={`${closing ? "ma-sheet-out" : "ma-sheet-in"} fixed inset-0 z-50 flex flex-col`}
      style={{ backgroundColor: "var(--tg-bg)", color: "var(--tg-text)" }}
      onTouchStart={(e) => {
        touchStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }}
      onTouchMove={(e) => {
        if (!touchStart.current) return;
        const dy = e.touches[0].clientY - touchStart.current.y;
        const dx = Math.abs(e.touches[0].clientX - touchStart.current.x);
        // Swipe-down duplicates the X / BackButton close (П5).
        if (dy > 70 && dx < 50) {
          touchStart.current = null;
          requestClose();
        }
      }}
      onTouchEnd={() => {
        touchStart.current = null;
      }}
    >
      <div
        className="flex items-center justify-between px-4 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
      >
        <div className="text-base font-bold">{t.ticket.title}</div>
        <button
          type="button"
          aria-label={t.common.close}
          onClick={requestClose}
          className="grid h-9 w-9 place-items-center rounded-full ma-press active:scale-95"
          style={{
            backgroundColor:
              "color-mix(in oklch, var(--tg-hint) 14%, transparent)",
          }}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        <div
          className="relative mx-auto mt-3 w-full max-w-[380px] rounded-3xl px-5 pb-6 pt-6"
          style={{
            backgroundColor: "var(--tg-section-bg)",
            boxShadow: "var(--ma-card-shadow)",
          }}
        >
          <div className="flex items-center gap-2">
            {live ? <LiveDot color={isNext ? SALMON : GREEN} /> : null}
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.ticket.caption}
            </span>
          </div>
          <div
            className="mt-1 text-[56px] font-extrabold leading-none tracking-tight tabular-nums"
            style={{ color: "var(--tg-accent)" }}
          >
            {bigNumber}
          </div>
          {isNext ? (
            <>
              <div
                className="mt-2 text-lg font-bold leading-tight"
                style={{ color: SALMON }}
              >
                {t.home.hero.youAreNext}
              </div>
              <div
                className="mt-0.5 text-sm"
                style={{ color: "var(--tg-hint)" }}
              >
                {t.home.hero.youAreNextHint}
              </div>
            </>
          ) : waiting ? (
            <>
              <div className="mt-2 text-lg font-bold leading-tight">
                {aheadTemplate.replace("{n}", String(ahead))}
              </div>
              <div
                className="mt-0.5 text-sm font-medium"
                style={{ color: "var(--tg-accent)" }}
              >
                {`${t.home.hero.etaWait.replace("{n}", String(data!.etaMinutes ?? 0))} · ${etaFlavor}`}
              </div>
            </>
          ) : inProgress ? (
            <div
              className="mt-2 text-lg font-bold leading-tight"
              style={{ color: GREEN }}
            >
              {t.home.hero.inProgressTitle}
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <DetailCell label={t.ticket.doctor} value={doctorName} wide />
            <DetailCell label={t.ticket.cabinet} value={cabinet} />
            <DetailCell label={t.ticket.time} value={time} />
          </div>
          <div aria-hidden className="relative my-5">
            <span
              className="absolute -left-8 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: "var(--tg-bg)" }}
            />
            <span
              className="absolute -right-8 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: "var(--tg-bg)" }}
            />
            <div
              className="border-t-2 border-dashed"
              style={{
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 28%, transparent)",
              }}
            />
          </div>
          <div className="flex flex-col items-center gap-3">
            {qr ? (
              <div className="rounded-2xl bg-white p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="" className="h-44 w-44" />
              </div>
            ) : null}
            <p
              className="max-w-[240px] text-center text-xs leading-relaxed"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.ticket.showAtReception}
            </p>
            {ticketCode ? (
              <span
                className="rounded-full px-3 py-1 text-xs font-bold tabular-nums"
                style={{
                  backgroundColor:
                    "color-mix(in oklch, var(--tg-hint) 14%, transparent)",
                }}
              >
                {t.ticket.codeLabel}: {ticketCode}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
