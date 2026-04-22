"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useDoctors } from "../../_hooks/use-doctors";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import {
  MCard,
  MEmpty,
  MListItem,
  MSection,
  MSpinner,
} from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function DoctorPicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const tg = useTelegramWebApp();

  // If the user lands here without a service picked, bounce back.
  React.useEffect(() => {
    if (hydrated && draft.serviceIds.length === 0) {
      router.replace(`/c/${clinicSlug}/my/book/service`);
    }
  }, [hydrated, draft.serviceIds, router, clinicSlug]);

  const primaryServiceId = draft.serviceIds[0] ?? null;
  const doctors = useDoctors(primaryServiceId);

  const canContinue = !!draft.doctorId;

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(`/c/${clinicSlug}/my/book/service`),
    );
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.common.next,
      active: canContinue,
      visible: true,
      onClick: () => {
        if (!canContinue) return;
        router.push(`/c/${clinicSlug}/my/book/slot`);
      },
    });
    return off;
  }, [tg, canContinue, router, clinicSlug, t.common.next]);

  if (!hydrated) return <MSpinner label={t.common.loading} />;

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
          {t.book.stepDoctor}
        </div>
        <h1 className="text-xl font-bold">{t.book.pickDoctor}</h1>
      </div>
      <MSection>
        {doctors.isLoading ? (
          <MSpinner />
        ) : doctors.data && doctors.data.length > 0 ? (
          doctors.data.map((d) => {
            const active = draft.doctorId === d.id;
            return (
              <MListItem
                key={d.id}
                active={active}
                onClick={() => {
                  tg.haptic.selection();
                  setDraft({ doctorId: d.id, date: null, time: null });
                }}
              >
                {d.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.photoUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: d.color }}
                  >
                    {(lang === "UZ" ? d.nameUz : d.nameRu).slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {lang === "UZ" ? d.nameUz : d.nameRu}
                  </div>
                  <div
                    className="mt-0.5 truncate text-xs"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {lang === "UZ" ? d.specializationUz : d.specializationRu}
                  </div>
                  {d.rating ? (
                    <div className="mt-0.5 text-xs" style={{ color: "var(--tg-accent)" }}>
                      {t.book.rating.replace("{rating}", String(d.rating))}
                      {d.reviewCount > 0 ? (
                        <span className="ml-1" style={{ color: "var(--tg-hint)" }}>
                          {t.book.reviewCount.replace("{count}", String(d.reviewCount))}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </MListItem>
            );
          })
        ) : (
          <MEmpty>{t.book.noDoctors}</MEmpty>
        )}
      </MSection>
      <MCard className="mt-4 text-xs" style={{ color: "var(--tg-hint)" }}>
        {t.book.summaryService}: {draft.serviceIds.length}
      </MCard>
    </div>
  );
}
