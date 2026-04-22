"use client";

import * as React from "react";

import {
  MButton,
  MCard,
  formatDateISO,
} from "../mini-ui";
import { useT } from "../mini-i18n";
import {
  MiniAppAppointment,
  useCancelAppointment,
  useRescheduleAppointment,
} from "../../_hooks/use-appointments";
import { useSlots } from "../../_hooks/use-slots";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

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
}: {
  appointment: MiniAppAppointment;
  onClose: () => void;
}) {
  const t = useT();
  const { state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const tg = useTelegramWebApp();
  const [mode, setMode] = React.useState<"view" | "reschedule">("view");
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string | null>(null);

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

  const onCancel = async () => {
    const ok = await tg.showConfirm(t.appts.cancelConfirm);
    if (!ok) return;
    try {
      await cancel.mutateAsync(appointment.id);
      tg.haptic.notification("success");
      tg.showAlert(t.appts.cancelSuccess);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[430px] rounded-t-2xl p-4 pb-8"
        style={{ backgroundColor: "var(--tg-bg)", color: "var(--tg-text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.appts.detailTitle}</h2>
          <button
            type="button"
            onClick={onClose}
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
          editable ? (
            <div className="grid grid-cols-1 gap-2">
              <MButton
                variant="secondary"
                onClick={() => setMode("reschedule")}
              >
                {t.appts.reschedule}
              </MButton>
              <MButton variant="danger" onClick={onCancel} disabled={cancel.isPending}>
                {t.appts.cancel}
              </MButton>
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
      </div>
    </div>
  );
}
