"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MCard,
  MEmpty,
  MSection,
  MSpinner,
  formatDateISO,
} from "../mini-ui";
import { useT } from "../mini-i18n";
import { useAppointments, MiniAppAppointment } from "../../_hooks/use-appointments";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { AppointmentDetailDialog } from "./appointment-detail-dialog";

type Tab = "upcoming" | "past";

export function AppointmentsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const tg = useTelegramWebApp();
  const [tab, setTab] = React.useState<Tab>("upcoming");
  const [selected, setSelected] = React.useState<MiniAppAppointment | null>(null);
  const query = useAppointments(tab);

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    // Hide MainButton on this screen — users act via row clicks.
    const off = tg.setMainButton({ visible: false });
    return off;
  }, [tg]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.appts.title}</h1>
      </div>
      <div
        className="mb-4 flex rounded-xl p-1"
        style={{ backgroundColor: "var(--tg-section-bg)" }}
      >
        {(["upcoming", "past"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              tab === k ? "shadow-sm" : ""
            }`}
            style={
              tab === k
                ? { backgroundColor: "var(--tg-accent)", color: "#fff" }
                : { color: "var(--tg-text)" }
            }
          >
            {k === "upcoming" ? t.appts.tabUpcoming : t.appts.tabPast}
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <MSpinner />
      ) : query.data && query.data.length > 0 ? (
        <MSection>
          {query.data.map((appt) => (
            <button
              key={appt.id}
              type="button"
              onClick={() => setSelected(appt)}
              className="block w-full text-left"
            >
              <MCard className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu}
                    </div>
                    <div
                      className="truncate text-xs"
                      style={{ color: "var(--tg-hint)" }}
                    >
                      {lang === "UZ"
                        ? appt.doctor.specializationUz
                        : appt.doctor.specializationRu}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">
                      {formatDateISO(appt.date, lang)}
                    </div>
                    <div className="text-xs" style={{ color: "var(--tg-accent)" }}>
                      {appt.time}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--tg-hint)" }}>
                    {t.appts.status[appt.status as keyof typeof t.appts.status] ?? appt.status}
                  </span>
                  {appt.priceFinal ? (
                    <span style={{ color: "var(--tg-hint)" }}>
                      {appt.payments.some((p) => p.status === "PAID")
                        ? t.appts.paid
                        : t.appts.unpaid}
                    </span>
                  ) : null}
                </div>
              </MCard>
            </button>
          ))}
        </MSection>
      ) : (
        <MEmpty>{tab === "upcoming" ? t.appts.emptyUpcoming : t.appts.emptyPast}</MEmpty>
      )}
      {selected ? (
        <AppointmentDetailDialog
          appointment={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
