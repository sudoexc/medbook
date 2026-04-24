"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useServices } from "../../_hooks/use-services";
import { useDoctors } from "../../_hooks/use-doctors";
import { useBookAppointment } from "../../_hooks/use-appointments";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import {
  MCard,
  MEmpty,
  MHint,
  MSpinner,
  formatDateISO,
  formatSum,
} from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { WizardHeader } from "./wizard-header";
import { WizardFooter } from "./wizard-footer";

function applyTimeToDate(dateISO: string, time: string): string {
  const [y, m, d] = dateISO.split("-").map((v) => Number.parseInt(v, 10));
  const [h, min] = time.split(":").map((v) => Number.parseInt(v, 10));
  const d2 = new Date(y, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0);
  return d2.toISOString();
}

export function BookConfirm() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const patient = state.status === "ready" ? state.patient : null;
  const lang = patient?.preferredLang ?? "RU";
  const { draft, reset, hydrated } = useBookingDraft(clinicSlug);
  const services = useServices();
  const doctors = useDoctors(null);
  const book = useBookAppointment();
  const tg = useTelegramWebApp();

  const [name, setName] = React.useState<string>(patient?.fullName ?? "");
  const [phone, setPhone] = React.useState<string>(patient?.phone ?? "");
  // Sync patient profile values into the form ONCE per patient load. Using
  // `!name` as a guard re-populated the field every time the user cleared
  // it, which made it impossible to edit out a seeded "Dev User".
  const syncedRef = React.useRef({ name: false, phone: false });
  React.useEffect(() => {
    if (!patient) return;
    if (patient.fullName && !syncedRef.current.name) {
      setName(patient.fullName);
      syncedRef.current.name = true;
    }
    if (patient.phone && !syncedRef.current.phone) {
      setPhone(patient.phone);
      syncedRef.current.phone = true;
    }
  }, [patient]);

  const selectedServices =
    services.data?.filter((s) => draft.serviceIds.includes(s.id)) ?? [];
  const doctor = doctors.data?.find((d) => d.id === draft.doctorId) ?? null;
  const total = selectedServices.reduce((a, s) => a + s.priceBase, 0);

  const canSubmit =
    !!draft.doctorId &&
    draft.serviceIds.length > 0 &&
    !!draft.date &&
    !!draft.time &&
    name.trim().length >= 2 &&
    phone.trim().length >= 5;

  const submit = React.useCallback(async () => {
    if (!canSubmit || !draft.date || !draft.time || !draft.doctorId) return;
    try {
      const startAt = applyTimeToDate(draft.date, draft.time);
      const appt = await book.mutateAsync({
        doctorId: draft.doctorId,
        serviceIds: draft.serviceIds,
        startAt,
        patientName: name.trim(),
        patientPhone: phone.trim(),
        lang,
      });
      tg.haptic.notification("success");
      reset();
      router.push(`/c/${clinicSlug}/my/book/done?id=${appt.id}`);
    } catch (e) {
      tg.haptic.notification("error");
      const err = e as Error & { status?: number; data?: { reason?: string } };
      const reason = err.data?.reason ?? err.message;
      if (err.status === 409) tg.showAlert(t.book.errorConflict);
      else tg.showAlert(t.book.errorBooking.replace("{reason}", reason));
    }
  }, [
    canSubmit,
    draft,
    name,
    phone,
    lang,
    book,
    reset,
    router,
    clinicSlug,
    tg,
    t.book.errorConflict,
    t.book.errorBooking,
  ]);

  React.useEffect(() => {
    const off = tg.setBackButton(() =>
      router.push(`/c/${clinicSlug}/my/book/slot`),
    );
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: book.isPending ? t.book.bookInProgress : t.book.bookBtn,
      active: canSubmit && !book.isPending,
      progress: book.isPending,
      visible: true,
      onClick: submit,
    });
    return off;
  }, [tg, canSubmit, book.isPending, submit, t.book.bookBtn, t.book.bookInProgress]);

  if (!hydrated) return <MSpinner label={t.common.loading} />;
  if (!draft.doctorId || !draft.date || !draft.time) {
    return (
      <MEmpty>
        <div className="space-y-2">
          <p>{t.common.error}</p>
          <button
            className="text-sm font-semibold"
            style={{ color: "var(--tg-accent)" }}
            onClick={() => router.push(`/c/${clinicSlug}/my/book/service`)}
          >
            {t.common.retry}
          </button>
        </div>
      </MEmpty>
    );
  }

  return (
    <div>
      <WizardHeader
        step={4}
        label={t.book.stepLabel.replace("{step}", "4").replace("{total}", "4")}
        title={t.book.stepConfirm}
      />
      <MCard className="mb-3">
        <div className="flex items-start gap-3">
          {doctor?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doctor.photoUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl object-cover"
            />
          ) : (
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-white"
              style={{ backgroundColor: doctor?.color ?? "var(--tg-accent)" }}
            >
              {(doctor ? (lang === "UZ" ? doctor.nameUz : doctor.nameRu) : "?").slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {doctor ? (lang === "UZ" ? doctor.nameUz : doctor.nameRu) : "—"}
            </div>
            <div
              className="mt-0.5 truncate text-xs"
              style={{ color: "var(--tg-hint)" }}
            >
              {doctor
                ? lang === "UZ"
                  ? doctor.specializationUz
                  : doctor.specializationRu
                : null}
            </div>
          </div>
        </div>
      </MCard>
      <MCard className="mb-3">
        <div className="space-y-3 text-sm">
          <Row label={t.book.summaryDate}>
            {draft.date ? formatDateISO(draft.date + "T00:00:00", lang) : "—"}
          </Row>
          <Row label={t.book.summaryTime}>{draft.time ?? "—"}</Row>
          {selectedServices.length > 0 ? (
            <Row label={t.book.summaryService}>
              <div className="space-y-1">
                {selectedServices.map((s) => (
                  <div key={s.id}>{lang === "UZ" ? s.nameUz : s.nameRu}</div>
                ))}
              </div>
            </Row>
          ) : null}
          <Row label={t.book.summaryPrice}>
            <strong>{formatSum(total, t.common.currency)}</strong>
          </Row>
        </div>
      </MCard>
      <MCard className="mb-3">
        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
              {t.book.nameLabel}
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
              {t.book.phoneLabel}
            </div>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 000 00 00"
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
            <div className="mt-1">
              <MHint>{t.book.phoneHint}</MHint>
            </div>
          </label>
        </div>
      </MCard>
      <div
        className="rounded-2xl px-4 py-3 text-center text-xs"
        style={{
          backgroundColor: "color-mix(in oklch, var(--tg-accent) 8%, transparent)",
          color: "var(--tg-hint)",
        }}
      >
        {t.book.paymentNote}
      </div>
      <WizardFooter
        primaryLabel={book.isPending ? t.book.bookInProgress : t.book.bookBtn}
        onPrimary={submit}
        disabled={!canSubmit}
        loading={book.isPending}
        tagline={t.book.clinicTagline}
      />
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span style={{ color: "var(--tg-hint)" }}>{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
