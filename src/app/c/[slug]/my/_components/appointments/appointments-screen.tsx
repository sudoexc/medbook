"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, History } from "lucide-react";

import {
  MCard,
  MEmpty,
  MSection,
  formatDateISO,
} from "../mini-ui";
import { getAppointmentTone } from "../mini-app-tokens";
import { SkeletonList } from "../skeleton";
import { useT } from "../mini-i18n";
import {
  useAppointments,
  useAppointmentsLiveSync,
  useCancelAppointment,
  MiniAppAppointment,
} from "../../_hooks/use-appointments";
import { useActiveContext } from "../../_hooks/use-active-context";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { AppointmentDetailDialog } from "./appointment-detail-dialog";
import { CancelReasonDialog } from "./cancel-reason-dialog";

const CANCELLABLE_STATUSES = new Set(["BOOKED", "CONFIRMED", "WAITING", "SKIPPED"]);

type Tab = "upcoming" | "past";

export function AppointmentsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const tg = useTelegramWebApp();
  const { onBehalfOf } = useActiveContext();
  const [tab, setTab] = React.useState<Tab>("upcoming");
  const [selected, setSelected] = React.useState<MiniAppAppointment | null>(null);
  const [selectedMode, setSelectedMode] =
    React.useState<"view" | "reschedule">("view");
  const [cancelTarget, setCancelTarget] =
    React.useState<MiniAppAppointment | null>(null);
  const cancel = useCancelAppointment();
  const query = useAppointments(tab, onBehalfOf);
  // SSE — invalidate caches when CRM / other surfaces mutate this patient's
  // appointments (TZ §6.1). Mounted at the screen level so it stays alive
  // while the patient is on this view.
  useAppointmentsLiveSync();

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
        <SkeletonList rows={4} variant="appointment" />
      ) : query.data && query.data.length > 0 ? (
        <MSection>
          {query.data.map((appt) => {
            const cancellable =
              tab === "upcoming" && CANCELLABLE_STATUSES.has(appt.status);
            const tone = getAppointmentTone(appt.status);
            return (
              <div key={appt.id} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMode("view");
                    setSelected(appt);
                  }}
                  className="block w-full text-left"
                >
                  <MCard
                    className="space-y-1"
                    style={{
                      borderLeft: `3px solid ${tone.border}`,
                      backgroundImage: `linear-gradient(to right, ${tone.tint}, transparent 40%)`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 pr-7">
                        <div className="truncate text-sm font-semibold">
                          {lang === "UZ"
                            ? appt.doctor.nameUz
                            : appt.doctor.nameRu}
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
                      <div className={`shrink-0 text-right ${cancellable ? "pr-9" : ""}`}>
                        <div className="text-sm font-semibold">
                          {formatDateISO(appt.date, lang)}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: "var(--tg-accent)" }}
                        >
                          {appt.time}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className="font-medium"
                        style={{ color: tone.label }}
                      >
                        {t.appts.status[
                          appt.status as keyof typeof t.appts.status
                        ] ?? appt.status}
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
                {cancellable ? (
                  <button
                    type="button"
                    aria-label={t.appts.cancel}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setCancelTarget(appt);
                    }}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-base leading-none"
                    style={{
                      color: "var(--tg-hint)",
                      backgroundColor:
                        "color-mix(in oklch, var(--tg-bg) 60%, transparent)",
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
        </MSection>
      ) : (
        <MEmpty icon={tab === "upcoming" ? CalendarCheck : History}>
          {tab === "upcoming" ? t.appts.emptyUpcoming : t.appts.emptyPast}
        </MEmpty>
      )}
      {selected ? (
        <AppointmentDetailDialog
          appointment={selected}
          initialMode={selectedMode}
          onClose={() => {
            setSelected(null);
            setSelectedMode("view");
          }}
        />
      ) : null}
      <CancelReasonDialog
        open={cancelTarget !== null}
        isPending={cancel.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          try {
            await cancel.mutateAsync({ id: cancelTarget.id, reason });
            tg.haptic.notification("success");
            tg.showAlert(t.appts.cancelSuccess);
            setCancelTarget(null);
          } catch (e) {
            tg.haptic.notification("error");
            tg.showAlert((e as Error).message);
          }
        }}
        onPickReschedule={() => {
          if (!cancelTarget) return;
          const target = cancelTarget;
          setCancelTarget(null);
          setSelectedMode("reschedule");
          setSelected(target);
        }}
      />
    </div>
  );
}
