"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import {
  minDoctorPrice,
  pickDefaultService,
  useDoctors,
} from "../../_hooks/use-doctors";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useActiveContext } from "../../_hooks/use-active-context";
import { bookHref } from "../../_lib/booking-context";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MEmpty, MSpinner, formatSum } from "../mini-ui";
import { MA_ACCENTS } from "../mini-app-tokens";
import { SkeletonList } from "../skeleton";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { WizardHeader } from "./wizard-header";
import { WizardFooter } from "./wizard-footer";

export function DoctorPicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const { onBehalfOf } = useActiveContext();
  const tg = useTelegramWebApp();
  const doctors = useDoctors(null);

  React.useEffect(() => {
    if (hydrated && !draft.specialization) {
      router.replace(bookHref(clinicSlug, "service", onBehalfOf));
    }
  }, [hydrated, draft.specialization, router, clinicSlug, onBehalfOf]);

  const filtered = React.useMemo(() => {
    if (!doctors.data || !draft.specialization) return [];
    return doctors.data.filter(
      (d) => d.specializationRu.trim() === draft.specialization,
    );
  }, [doctors.data, draft.specialization]);

  // «Записаться на контроль» seeds the draft with the PAST visit's doctor,
  // who may have been deactivated since — the roster (isActive-filtered)
  // then renders no card for them, yet the invisible selection would let
  // the patient continue straight into a slot-screen dead end. Clear it.
  React.useEffect(() => {
    if (!doctors.data || !draft.doctorId) return;
    if (!filtered.some((d) => d.id === draft.doctorId)) {
      setDraft({ doctorId: null, date: null, time: null });
    }
  }, [doctors.data, filtered, draft.doctorId, setDraft]);

  // Continue only with a doctor that actually exists on the roster — the
  // seeded-but-invisible selection must not count.
  const canContinue = filtered.some((d) => d.id === draft.doctorId);

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
      onBehalfOf,
    });
    router.push(bookHref(clinicSlug, "slot", onBehalfOf));
  }, [canContinue, draft.doctorId, filtered, setDraft, router, clinicSlug, onBehalfOf]);

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(bookHref(clinicSlug, "service", onBehalfOf)),
    );
    return off;
  }, [tg, router, clinicSlug, onBehalfOf]);

  if (!hydrated) return <MSpinner label={t.common.loading} />;

  return (
    <div className="ma-step-enter">
      <WizardHeader
        step={2}
        label={t.book.stepLabel.replace("{step}", "2").replace("{total}", "4")}
        title={t.book.stepDoctor}
      />
      {doctors.isLoading ? (
        <SkeletonList rows={4} variant="card" />
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
            const minPrice = minDoctorPrice(d.services);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  tg.haptic.selection();
                  setDraft({ doctorId: d.id, date: null, time: null });
                }}
                className="flex w-full items-start gap-3 rounded-2xl p-3 text-left ma-press active:scale-[0.99]"
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {rating !== null && !Number.isNaN(rating) ? (
                      <div className="flex items-center gap-1">
                        <Star
                          className="h-3.5 w-3.5"
                          style={{
                            color: MA_ACCENTS.warning,
                            fill: MA_ACCENTS.warning,
                          }}
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
                      <span
                        className="text-xs"
                        style={{ color: "var(--tg-hint)" }}
                      >
                        {t.book.newDoctor}
                      </span>
                    )}
                    {minPrice !== null ? (
                      <span
                        className="text-xs font-semibold"
                        style={{ color: "var(--tg-accent)" }}
                      >
                        {t.book.priceFrom.replace(
                          "{price}",
                          formatSum(minPrice, lang),
                        )}
                      </span>
                    ) : null}
                  </div>
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
