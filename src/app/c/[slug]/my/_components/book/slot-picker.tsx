"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useSlots } from "../../_hooks/use-slots";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MEmpty, MSpinner } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { WizardHeader } from "./wizard-header";
import { WizardFooter } from "./wizard-footer";

const DAYS_AHEAD = 14;
const INITIAL_SLOTS = 9;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayShort(d: Date, lang: "RU" | "UZ"): string {
  const base = d.toLocaleDateString(
    lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
    { weekday: "short" },
  );
  return base.replace(".", "");
}

function monthShort(d: Date, lang: "RU" | "UZ"): string {
  const base = d.toLocaleDateString(
    lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
    { month: "short" },
  );
  return base.replace(".", "");
}

export function SlotPicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const tg = useTelegramWebApp();
  const [expanded, setExpanded] = React.useState(false);

  const days = React.useMemo(() => {
    const arr: { iso: string; weekday: string; day: number; month: string }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      arr.push({
        iso: formatIsoDate(d),
        weekday: weekdayShort(d, lang),
        day: d.getDate(),
        month: monthShort(d, lang),
      });
    }
    return arr;
  }, [lang]);

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

  // Seed `draft.date` with the first visible day so "Продолжить" activates
  // after the user picks a time alone (without having to re-tap a date).
  React.useEffect(() => {
    if (hydrated && !draft.date) {
      setDraft({ date: days[0].iso });
    }
  }, [hydrated, draft.date, days, setDraft]);

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(`/c/${clinicSlug}/my/book/doctor`),
    );
    return off;
  }, [tg, router, clinicSlug]);

  const canContinue = !!draft.date && !!draft.time;

  const goNext = React.useCallback(() => {
    if (!canContinue) return;
    router.push(`/c/${clinicSlug}/my/book/confirm`);
  }, [canContinue, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.book.continue,
      active: canContinue,
      visible: true,
      onClick: goNext,
    });
    return off;
  }, [tg, canContinue, goNext, t.book.continue]);

  if (!hydrated) return <MSpinner label={t.common.loading} />;

  const allSlots = slots.data?.slots ?? [];
  const visibleSlots = expanded ? allSlots : allSlots.slice(0, INITIAL_SLOTS);
  const hasMore = allSlots.length > INITIAL_SLOTS;

  return (
    <div className="ma-step-enter">
      <WizardHeader
        step={3}
        label={t.book.stepLabel.replace("{step}", "3").replace("{total}", "4")}
        title={t.book.stepSlot}
      />
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const active = selectedDate === d.iso;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => {
                tg.haptic.selection();
                setDraft({ date: d.iso, time: null });
                setExpanded(false);
              }}
              className="flex min-h-[68px] min-w-[68px] shrink-0 flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs transition active:scale-[0.98]"
              style={
                active
                  ? {
                      backgroundColor: "var(--tg-accent)",
                      color: "#fff",
                    }
                  : {
                      backgroundColor: "var(--tg-section-bg)",
                      color: "var(--tg-text)",
                    }
              }
            >
              <span
                style={{
                  color: active
                    ? "rgba(255,255,255,0.85)"
                    : "var(--tg-hint)",
                }}
              >
                {d.weekday}
              </span>
              <span className="mt-1 text-lg font-semibold">{d.day}</span>
              <span
                className="text-[10px]"
                style={{
                  color: active
                    ? "rgba(255,255,255,0.85)"
                    : "var(--tg-hint)",
                }}
              >
                {d.month}
              </span>
            </button>
          );
        })}
      </div>
      {slots.isLoading ? (
        <MSpinner />
      ) : allSlots.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {visibleSlots.map((slot) => {
              const active = draft.time === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => {
                    tg.haptic.selection();
                    setDraft({ time: slot });
                  }}
                  className="min-h-[48px] rounded-xl px-2 py-2 text-sm font-semibold transition active:scale-[0.98]"
                  style={
                    active
                      ? { backgroundColor: "var(--tg-accent)", color: "#fff" }
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
          {hasMore ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold"
              style={{
                backgroundColor: "transparent",
                color: "var(--tg-accent)",
              }}
            >
              {expanded ? t.book.showLess : t.book.showMoreTime}
            </button>
          ) : null}
        </>
      ) : (
        <MEmpty>{t.book.noSlots}</MEmpty>
      )}
      <WizardFooter
        primaryLabel={t.book.continue}
        onPrimary={goNext}
        disabled={!canContinue}
        tagline={t.book.clinicTagline}
      />
    </div>
  );
}
