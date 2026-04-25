"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import { pickDefaultService, useDoctors } from "../../_hooks/use-doctors";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MEmpty, MSpinner } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { WizardHeader } from "./wizard-header";
import { WizardFooter } from "./wizard-footer";

export function DoctorPicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const tg = useTelegramWebApp();
  const doctors = useDoctors(null);

  React.useEffect(() => {
    if (hydrated && !draft.specialization) {
      router.replace(`/c/${clinicSlug}/my/book/service`);
    }
  }, [hydrated, draft.specialization, router, clinicSlug]);

  const filtered = React.useMemo(() => {
    if (!doctors.data || !draft.specialization) return [];
    return doctors.data.filter(
      (d) => d.specializationRu.trim() === draft.specialization,
    );
  }, [doctors.data, draft.specialization]);

  const canContinue = !!draft.doctorId;

  const goNext = React.useCallback(() => {
    if (!canContinue) return;
    // Auto-assign a sensible default service so the API body stays valid —
    // the wizard UX is specialty-first but the booking endpoint still
    // requires serviceIds. `pickDefaultService` prefers a consultation
    // category, else the cheapest, to avoid surfacing premium procedure
    // prices to a patient who just wants a first visit.
    const doctor = filtered.find((d) => d.id === draft.doctorId);
    const defaultService = doctor ? pickDefaultService(doctor.services) : null;
    setDraft({
      serviceIds: defaultService ? [defaultService] : [],
      date: null,
      time: null,
    });
    router.push(`/c/${clinicSlug}/my/book/slot`);
  }, [canContinue, draft.doctorId, filtered, setDraft, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(`/c/${clinicSlug}/my/book/service`),
    );
    return off;
  }, [tg, router, clinicSlug]);

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

  return (
    <div className="ma-step-enter">
      <WizardHeader
        step={2}
        label={t.book.stepLabel.replace("{step}", "2").replace("{total}", "4")}
        title={t.book.stepDoctor}
      />
      {doctors.isLoading ? (
        <MSpinner />
      ) : filtered.length === 0 ? (
        <MEmpty>{t.book.noDoctors}</MEmpty>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const active = draft.doctorId === d.id;
            const name = lang === "UZ" ? d.nameUz : d.nameRu;
            const spec = lang === "UZ" ? d.specializationUz : d.specializationRu;
            const rating =
              typeof d.rating === "number"
                ? d.rating
                : typeof d.rating === "string"
                  ? Number.parseFloat(d.rating)
                  : null;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  tg.haptic.selection();
                  setDraft({ doctorId: d.id, date: null, time: null });
                }}
                className="flex w-full items-start gap-3 rounded-2xl p-3 text-left transition active:scale-[0.99]"
                style={{
                  backgroundColor: active
                    ? "color-mix(in oklch, var(--tg-accent) 8%, var(--tg-section-bg))"
                    : "var(--tg-section-bg)",
                  color: "var(--tg-text)",
                  boxShadow: active
                    ? `0 0 0 2px var(--tg-accent)`
                    : "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                {d.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.photoUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                  />
                ) : (
                  <div
                    className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-white"
                    style={{ backgroundColor: d.color }}
                  >
                    {name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{name}</div>
                  <div
                    className="mt-0.5 truncate text-xs"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {spec}
                  </div>
                  <div
                    className="mt-1 text-xs"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {t.book.experienceStub}
                  </div>
                  {rating !== null && !Number.isNaN(rating) ? (
                    <div className="mt-1.5 flex items-center gap-1">
                      <Star
                        className="h-3.5 w-3.5"
                        style={{ color: "#F5A524", fill: "#F5A524" }}
                      />
                      <span className="text-xs font-semibold">{rating.toFixed(1)}</span>
                      {d.reviewCount > 0 ? (
                        <span
                          className="text-xs"
                          style={{ color: "var(--tg-hint)" }}
                        >
                          ({d.reviewCount})
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className="mt-1.5 text-xs"
                      style={{ color: "var(--tg-hint)" }}
                    >
                      {t.book.newDoctor}
                    </div>
                  )}
                </div>
                {active ? <CheckCircle /> : null}
              </button>
            );
          })}
        </div>
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

function CheckCircle() {
  return (
    <div
      className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full"
      style={{ backgroundColor: "var(--tg-accent)", color: "#fff" }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
