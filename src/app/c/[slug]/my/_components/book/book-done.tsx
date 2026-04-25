"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";

import { useAppointments } from "../../_hooks/use-appointments";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MButton, MCard, MSpinner, formatDateISO } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function BookDone() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const search = useSearchParams();
  const id = search.get("id");
  const upcoming = useAppointments("upcoming");
  const tg = useTelegramWebApp();

  const appointment = upcoming.data?.find((a) => a.id === id) ?? null;
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    QRCode.toDataURL(`ticket:${clinicSlug}:${id}`, { width: 256, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [id, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.done.goHome,
      active: true,
      visible: true,
      onClick: () => router.push(`/c/${clinicSlug}/my`),
    });
    return off;
  }, [tg, router, clinicSlug, t.done.goHome]);

  return (
    <div className="ma-step-enter">
      <MCard className="mb-4">
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
            style={{ backgroundColor: "#22C55E" }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3}>
              <path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t.done.title}</div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.done.subtitle}
            </div>
          </div>
        </div>
        {appointment ? (
          <div
            className="mt-4 space-y-2 border-t pt-3 text-sm"
            style={{
              borderTopColor: "color-mix(in oklch, var(--tg-hint) 15%, transparent)",
            }}
          >
            <div className="flex items-center gap-3">
              {appointment.doctor.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={appointment.doctor.photoUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: "var(--tg-accent)" }}
                >
                  {(lang === "UZ"
                    ? appointment.doctor.nameUz
                    : appointment.doctor.nameRu
                  ).slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {lang === "UZ"
                    ? appointment.doctor.nameUz
                    : appointment.doctor.nameRu}
                </div>
                <div
                  className="truncate text-xs"
                  style={{ color: "var(--tg-hint)" }}
                >
                  {lang === "UZ"
                    ? appointment.doctor.specializationUz
                    : appointment.doctor.specializationRu}
                </div>
              </div>
            </div>
            <div style={{ color: "var(--tg-accent)" }}>
              {formatDateISO(appointment.date, lang)} · {appointment.time}
            </div>
          </div>
        ) : null}
      </MCard>
      <MCard className="mb-4 flex flex-col items-center">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="" className="h-48 w-48 rounded-xl bg-white p-2" />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center">
            <MSpinner />
          </div>
        )}
        {id ? (
          <div className="mt-3 text-center">
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
              {t.done.ticketLabel}
            </div>
            <div className="font-mono text-sm">{id.slice(-8)}</div>
          </div>
        ) : null}
      </MCard>
      <div className="mt-4 grid grid-cols-1 gap-2">
        <Link href={`/c/${clinicSlug}/my/appointments`}>
          <MButton block variant="secondary">
            {t.done.viewMine}
          </MButton>
        </Link>
        <Link href={`/c/${clinicSlug}/my/book/service`}>
          <MButton block variant="ghost">
            {t.done.bookAnother}
          </MButton>
        </Link>
      </div>
    </div>
  );
}
