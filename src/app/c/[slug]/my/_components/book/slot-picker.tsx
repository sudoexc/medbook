"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useSlots } from "../../_hooks/use-slots";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MCard, MEmpty, MSpinner } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dayLabel(date: Date, lang: "RU" | "UZ", t: ReturnType<typeof useT>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return t.common.today;
  if (diff === 1) return t.common.tomorrow;
  return date.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
    weekday: "short",
  });
}

export function SlotPicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const tg = useTelegramWebApp();

  const days = React.useMemo(() => {
    const arr: { iso: string; label: string; day: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      arr.push({
        iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        label: dayLabel(d, lang, t),
        day: String(d.getDate()),
      });
    }
    return arr;
  }, [lang, t]);

  const selectedDate = draft.date ?? days[0].iso;
  const slots = useSlots({
    doctorId: draft.doctorId,
    date: selectedDate,
    serviceIds: draft.serviceIds,
  });

  React.useEffect(() => {
    if (hydrated && !draft.doctorId) {
      router.replace(`/c/${clinicSlug}/my/book/doctor`);
    }
  }, [hydrated, draft.doctorId, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(`/c/${clinicSlug}/my/book/doctor`),
    );
    return off;
  }, [tg, router, clinicSlug]);

  const canContinue = !!draft.date && !!draft.time;

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.common.next,
      active: canContinue,
      visible: true,
      onClick: () => {
        if (!canContinue) return;
        router.push(`/c/${clinicSlug}/my/book/confirm`);
      },
    });
    return off;
  }, [tg, canContinue, router, clinicSlug, t.common.next]);

  if (!hydrated) return <MSpinner label={t.common.loading} />;

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
          {t.book.stepSlot}
        </div>
        <h1 className="text-xl font-bold">{t.book.pickSlot}</h1>
      </div>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const active = selectedDate === d.iso;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => {
                tg.haptic.selection();
                setDraft({ date: d.iso, time: null });
              }}
              className={`flex min-h-[64px] min-w-[64px] shrink-0 flex-col items-center justify-center rounded-xl px-3 py-2 text-xs transition ${
                active ? "ring-2" : ""
              }`}
              style={{
                backgroundColor: "var(--tg-section-bg)",
                color: "var(--tg-text)",
                ...(active
                  ? ({ "--tw-ring-color": "var(--tg-accent)" } as React.CSSProperties)
                  : {}),
              }}
            >
              <span style={{ color: "var(--tg-hint)" }}>{d.label}</span>
              <span className="mt-1 text-lg font-semibold">{d.day}</span>
            </button>
          );
        })}
      </div>
      {slots.isLoading ? (
        <MSpinner />
      ) : slots.data && slots.data.slots.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {slots.data.slots.map((slot) => {
            const active = draft.time === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  tg.haptic.selection();
                  setDraft({ time: slot });
                }}
                className={`min-h-[44px] rounded-xl px-2 py-2 text-sm font-semibold transition ${
                  active ? "text-white" : ""
                }`}
                style={
                  active
                    ? { backgroundColor: "var(--tg-accent)" }
                    : {
                        backgroundColor: "var(--tg-section-bg)",
                        color: "var(--tg-text)",
                      }
                }
              >
                {slot}
              </button>
            );
          })}
        </div>
      ) : (
        <MEmpty>{t.book.noSlots}</MEmpty>
      )}
      <MCard className="mt-4 text-xs" style={{ color: "var(--tg-hint)" }}>
        {slots.data ? `${slots.data.slotMin} ${t.common.min}` : null}
      </MCard>
    </div>
  );
}
