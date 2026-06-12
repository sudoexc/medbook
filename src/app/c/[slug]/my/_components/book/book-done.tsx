"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import QRCode from "qrcode";

import {
  useAppointments,
  useAttachCase,
  type CaseAttachChoice,
} from "../../_hooks/use-appointments";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MButton, MCard, MSpinner, formatDateISO } from "../mini-ui";
import { MA_ACCENTS } from "../mini-app-tokens";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

function readCaseChoices(appointmentId: string): CaseAttachChoice[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `miniapp:caseChoice:${appointmentId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CaseAttachChoice[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function clearCaseChoices(appointmentId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`miniapp:caseChoice:${appointmentId}`);
  } catch {
    /* ignore */
  }
}

export function BookDone() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state, initData } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const search = useSearchParams();
  const id = search.get("id");
  const upcoming = useAppointments("upcoming");
  const tg = useTelegramWebApp();

  const appointment = upcoming.data?.find((a) => a.id === id) ?? null;
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  // Case-attach prompt — only shown when the booking POST returned 2+ open
  // cases. The choices live in sessionStorage so a refresh of /done preserves
  // them; once the patient picks (or dismisses), we clear them.
  const [caseChoices, setCaseChoices] = React.useState<
    CaseAttachChoice[] | null
  >(null);
  const [caseDismissed, setCaseDismissed] = React.useState(false);
  React.useEffect(() => {
    if (!id) return;
    setCaseChoices(readCaseChoices(id));
  }, [id]);
  const attachCase = useAttachCase();

  // The QR encodes the public scan URL `<origin>/t/<ticketCode>` — any phone
  // camera resolves it to the queue-status page without our own scanner. The
  // code is the source of truth (printed under the QR for manual entry), so
  // we wait for `appointment.ticketCode` to land before painting.
  const ticketCode = appointment?.ticketCode ?? null;
  React.useEffect(() => {
    if (!ticketCode) return;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/t/${ticketCode}`;
    QRCode.toDataURL(url, { width: 256, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [ticketCode]);

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  // Success haptic exactly once — the booking just landed, let the phone
  // confirm it physically along with the checkmark pop.
  const hapticFired = React.useRef(false);
  React.useEffect(() => {
    if (hapticFired.current || !tg.isTelegramContext) return;
    hapticFired.current = true;
    tg.haptic.notification("success");
  }, [tg]);

  return (
    <div className="ma-step-enter">
      <MCard className="mb-4">
        <div className="flex items-start gap-3">
          <div className="relative h-10 w-10 shrink-0">
            <div
              aria-hidden
              className="ma-ring absolute inset-0 rounded-full"
              style={{ backgroundColor: MA_ACCENTS.success }}
            />
            <div
              className="ma-check-pop relative grid h-10 w-10 place-items-center rounded-full text-white"
              style={{ backgroundColor: MA_ACCENTS.success }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3}>
                <path className="ma-draw" d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
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
          <img src={qrDataUrl} alt="" className="ma-fade-in h-48 w-48 rounded-xl bg-white p-2" />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center">
            <MSpinner />
          </div>
        )}
        {ticketCode ? (
          <div className="mt-3 text-center">
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
              {t.done.ticketLabel}
            </div>
            <div className="font-mono text-lg font-semibold tracking-widest">
              {ticketCode}
            </div>
          </div>
        ) : null}
      </MCard>
      {id && caseChoices && !caseDismissed ? (
        <MCard className="mb-4">
          <div className="text-sm font-semibold">{t.cases.questionTitle}</div>
          <div
            className="mt-1 text-xs"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.cases.questionSubtitle}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              disabled={attachCase.isPending}
              onClick={async () => {
                try {
                  await attachCase.mutateAsync({
                    appointmentId: id,
                    create: true,
                  });
                  tg.haptic.notification("success");
                  clearCaseChoices(id);
                  setCaseDismissed(true);
                } catch {
                  tg.haptic.notification("error");
                  // Non-blocking: hide the prompt so the user can move on.
                  clearCaseChoices(id);
                  setCaseDismissed(true);
                }
              }}
              className="rounded-xl px-3 py-3 text-sm font-semibold"
              style={{
                backgroundColor: "var(--tg-accent)",
                color: "white",
              }}
            >
              {t.cases.optionNew}
            </button>
            {caseChoices.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={attachCase.isPending}
                onClick={async () => {
                  try {
                    await attachCase.mutateAsync({
                      appointmentId: id,
                      caseId: c.id,
                    });
                    tg.haptic.notification("success");
                    clearCaseChoices(id);
                    setCaseDismissed(true);
                  } catch {
                    tg.haptic.notification("error");
                    clearCaseChoices(id);
                    setCaseDismissed(true);
                  }
                }}
                className="rounded-xl border px-3 py-3 text-left text-sm"
                style={{
                  borderColor:
                    "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                }}
              >
                <div className="font-semibold">{c.title}</div>
                <div
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--tg-hint)" }}
                >
                  {c.primaryDoctorName ? `${c.primaryDoctorName} · ` : ""}
                  {c.lastVisitAt
                    ? t.cases.lastVisit.replace(
                        "{date}",
                        formatDateISO(c.lastVisitAt, lang),
                      )
                    : t.cases.noVisits}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (id) clearCaseChoices(id);
                setCaseDismissed(true);
              }}
              className="text-xs"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.cases.skip}
            </button>
          </div>
        </MCard>
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-2">
        {id ? (
          <MButton
            block
            variant="secondary"
            onClick={() => {
              // Wave 3c — .ics download. tg.openLink routes through Telegram's
              // browser shim; auth rides on `?initData=` since a link
              // navigation can't carry our custom header.
              const qs = `clinicSlug=${encodeURIComponent(clinicSlug)}${
                initData ? `&initData=${encodeURIComponent(initData)}` : ""
              }`;
              const href = `${window.location.origin}/api/miniapp/appointments/${id}/ics?${qs}`;
              if (window.Telegram?.WebApp?.openLink) {
                try {
                  window.Telegram.WebApp.openLink(href);
                  tg.haptic.impact("light");
                  return;
                } catch {
                  /* fall through to anchor */
                }
              }
              window.location.href = href;
            }}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {t.done.addCalendar}
            </span>
          </MButton>
        ) : null}
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
