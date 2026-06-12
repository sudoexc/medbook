"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileText, MapPin, Repeat } from "lucide-react";

import {
  MButton,
  MCard,
  MSheet,
  formatDateISO,
} from "../mini-ui";
import { useT } from "../mini-i18n";
import {
  MiniAppAppointment,
  useCancelAppointment,
  useRescheduleAppointment,
} from "../../_hooks/use-appointments";
import { useSlots } from "../../_hooks/use-slots";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useClinic } from "../../_hooks/use-clinic";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { CancelReasonDialog } from "./cancel-reason-dialog";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function applyTimeToDate(dateISO: string, time: string): string {
  const [y, m, d] = dateISO.split("-").map((v) => Number.parseInt(v, 10));
  const [h, min] = time.split(":").map((v) => Number.parseInt(v, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0).toISOString();
}

export function AppointmentDetailDialog({
  appointment,
  onClose,
  initialMode = "view",
}: {
  appointment: MiniAppAppointment;
  onClose: () => void;
  initialMode?: "view" | "reschedule";
}) {
  const t = useT();
  const router = useRouter();
  const { state, initData, clinicSlug } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  // `<a target="_blank">` opens without our custom headers, so the conclusion
  // link carries init-data via query — same pattern as the documents screen.
  const conclusionLinkParam = initData
    ? `&initData=${encodeURIComponent(initData)}`
    : "";
  const tg = useTelegramWebApp();
  const { setDraft } = useBookingDraft(clinicSlug);
  const { data: clinic } = useClinic(clinicSlug);
  const [mode, setMode] = React.useState<"view" | "reschedule">(initialMode);
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const cancel = useCancelAppointment();
  const reschedule = useRescheduleAppointment();

  const days = React.useMemo(() => {
    const arr: { iso: string; day: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      arr.push({
        iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        day: String(d.getDate()),
        label: d.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
          weekday: "short",
        }),
      });
    }
    return arr;
  }, [lang]);

  const slots = useSlots({
    doctorId: appointment.doctor.id,
    date,
    serviceIds: appointment.services.map((s) => s.service.id),
  });

  const onCancelConfirm = async (reason: string | null) => {
    try {
      await cancel.mutateAsync({ id: appointment.id, reason });
      tg.haptic.notification("success");
      tg.showAlert(t.appts.cancelSuccess);
      setCancelOpen(false);
      onClose();
    } catch (e) {
      tg.haptic.notification("error");
      tg.showAlert((e as Error).message);
    }
  };

  const onReschedule = async () => {
    if (!date || !time) return;
    try {
      await reschedule.mutateAsync({
        id: appointment.id,
        startAt: applyTimeToDate(date, time),
      });
      tg.haptic.notification("success");
      tg.showAlert(t.appts.rescheduleSuccess);
      onClose();
    } catch (e) {
      tg.haptic.notification("error");
      tg.showAlert((e as Error).message);
    }
  };

  const editable = !["CANCELLED", "COMPLETED", "IN_PROGRESS"].includes(appointment.status);
  const completed = appointment.status === "COMPLETED";

  // tg.openLink routes through Telegram's browser shim; plain href fallback
  // keeps dev (regular browser) working — same pattern as ClinicInfoCard.
  const openExternal = (href: string) => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp?.openLink) {
      try {
        window.Telegram.WebApp.openLink(href);
        tg.haptic.impact("light");
        return;
      } catch {
        // fall through to anchor
      }
    }
    window.location.href = href;
  };

  const onAddCalendar = () => {
    const qs = `clinicSlug=${encodeURIComponent(clinicSlug)}${
      initData ? `&initData=${encodeURIComponent(initData)}` : ""
    }`;
    openExternal(
      `${window.location.origin}/api/miniapp/appointments/${appointment.id}/ics?${qs}`,
    );
  };

  const clinicName = clinic
    ? (lang === "UZ" ? clinic.nameUz : clinic.nameRu) || clinic.nameRu
    : null;
  const clinicAddress = clinic
    ? (lang === "UZ" ? (clinic.addressUz ?? clinic.addressRu) : clinic.addressRu)
    : null;
  const onRoute =
    clinicName && clinicAddress
      ? () =>
          openExternal(
            `https://yandex.com/maps/?text=${encodeURIComponent(`${clinicName}, ${clinicAddress}`)}`,
          )
      : null;

  // Wave 3c — «Записаться снова»: same wizard seeding as the follow-up CTA
  // (specialty-first wizard needs specialization or /book/doctor bounces).
  const bookAgain = () => {
    tg.haptic.selection();
    setDraft({
      specialization: appointment.doctor.specializationRu.trim() || null,
      serviceIds: [],
      doctorId: appointment.doctor.id,
      date: null,
      time: null,
    });
    router.push(`/c/${clinicSlug}/my/book/doctor`);
  };

  return (
    <>
    <MSheet onClose={onClose} ariaLabel={t.appts.detailTitle}>
      {(requestClose) => (
        <>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.appts.detailTitle}</h2>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.common.close}
          </button>
        </div>
        <MCard className="mb-3">
          <div className="text-sm font-semibold">
            {lang === "UZ" ? appointment.doctor.nameUz : appointment.doctor.nameRu}
          </div>
          <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
            {lang === "UZ"
              ? appointment.doctor.specializationUz
              : appointment.doctor.specializationRu}
          </div>
          <div className="mt-2 text-sm" style={{ color: "var(--tg-accent)" }}>
            {formatDateISO(appointment.date, lang)} · {appointment.time}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--tg-hint)" }}>
            {t.appts.status[appointment.status as keyof typeof t.appts.status] ?? appointment.status}
          </div>
        </MCard>
        {mode === "view" ? (
          appointment.conclusionUrl || editable || completed ? (
            <div className="grid grid-cols-1 gap-2">
              {completed ? (
                <Link
                  href={`/c/${clinicSlug}/my/visit/${appointment.id}`}
                  onClick={() => tg.haptic.selection()}
                >
                  <MButton variant="primary" className="w-full">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" aria-hidden />
                      {t.visit.title}
                    </span>
                  </MButton>
                </Link>
              ) : appointment.conclusionUrl ? (
                <a
                  href={`${appointment.conclusionUrl}${conclusionLinkParam}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MButton variant="primary" className="w-full">
                    {t.appts.conclusion}
                  </MButton>
                </a>
              ) : null}
              {completed ? (
                <MButton variant="secondary" onClick={bookAgain}>
                  <span className="inline-flex items-center gap-2">
                    <Repeat className="h-4 w-4" aria-hidden />
                    {t.appts.bookAgain}
                  </span>
                </MButton>
              ) : null}
              {editable ? (
                <>
                  <div
                    className={`grid gap-2 ${onRoute ? "grid-cols-2" : "grid-cols-1"}`}
                  >
                    <MButton variant="secondary" onClick={onAddCalendar}>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />
                        {t.appts.addCalendar}
                      </span>
                    </MButton>
                    {onRoute ? (
                      <MButton variant="secondary" onClick={onRoute}>
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                          {t.appts.route}
                        </span>
                      </MButton>
                    ) : null}
                  </div>
                  <MButton
                    variant="secondary"
                    onClick={() => setMode("reschedule")}
                  >
                    {t.appts.reschedule}
                  </MButton>
                  <MButton
                    variant="danger"
                    onClick={() => setCancelOpen(true)}
                    disabled={cancel.isPending}
                  >
                    {t.appts.cancel}
                  </MButton>
                </>
              ) : null}
            </div>
          ) : null
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t.appts.rescheduleTitle}</h3>
            <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map((d) => {
                const active = date === d.iso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => {
                      setDate(d.iso);
                      setTime(null);
                    }}
                    className={`flex min-h-[56px] min-w-[56px] shrink-0 flex-col items-center justify-center rounded-xl px-3 py-2 text-xs ${
                      active ? "ring-2" : ""
                    }`}
                    style={{
                      backgroundColor: "var(--tg-section-bg)",
                      color: "var(--tg-text)",
                    }}
                  >
                    <span style={{ color: "var(--tg-hint)" }}>{d.label}</span>
                    <span className="mt-0.5 text-base font-semibold">{d.day}</span>
                  </button>
                );
              })}
            </div>
            {slots.data ? (
              slots.data.slots.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {slots.data.slots.map((s) => {
                    const active = time === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTime(s)}
                        className="min-h-[44px] rounded-xl px-2 py-2 text-sm font-semibold"
                        style={
                          active
                            ? { backgroundColor: "var(--tg-accent)", color: "#fff" }
                            : {
                                backgroundColor: "var(--tg-section-bg)",
                                color: "var(--tg-text)",
                              }
                        }
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--tg-hint)" }}>
                  {t.book.noSlots}
                </p>
              )
            ) : null}
            <MButton
              block
              className="mt-4"
              variant="primary"
              onClick={onReschedule}
              disabled={!date || !time || reschedule.isPending}
            >
              {t.appts.rescheduleSave}
            </MButton>
          </div>
        )}
        </>
      )}
    </MSheet>
    <CancelReasonDialog
      open={cancelOpen}
      isPending={cancel.isPending}
      onClose={() => setCancelOpen(false)}
      onConfirm={onCancelConfirm}
      onPickReschedule={() => {
        setCancelOpen(false);
        setMode("reschedule");
      }}
    />
    </>
  );
}
