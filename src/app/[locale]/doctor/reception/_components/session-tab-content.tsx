"use client";

import { useTranslations } from "next-intl";

import { VisitsSection } from "../../patients/[id]/_components/visits-section";

import { useReceptionContext } from "../_hooks/reception-context";
import { AdvicePanel } from "./advice-panel";
import { ConclusionTemplateChannel } from "./conclusion-template-channel";
import { DiagnosisHistoryCard } from "./diagnosis-history-card";
import {
  DiagnosisPanel,
  FollowUpPanel,
  PrescriptionsPanel,
} from "./structured-fields-panel";

/**
 * Tab-driven body of the reception page.
 *
 * - `session` (default) — the live consultation: «Диагноз» and under it
 *   «Назначения» in the wide column, advice and under it the control visit
 *   in the side column. The conclusion text has no editor here any more;
 *   its preview opens from the sign bar.
 * - `history` / `documents` / `prescriptions` — read-only views of the
 *   active patient's chart, reusing the same doctor-scoped infinite queries
 *   from `/doctor/patients/[id]` so we don't fork two implementations.
 *
 * The non-session tabs are disabled in the strip when no patient is active
 * (handled in `session-tabs.tsx`), so by the time this renders we already
 * have a `patient.id`.
 */
export function SessionTabContent({ locale }: { locale: string }) {
  const t = useTranslations("doctor.reception");
  const { activeTab, activeAppointment } = useReceptionContext();
  const patientId = activeAppointment?.patient.id ?? null;

  if (activeTab === "session") {
    // Clinic-requested flow, reworked 29.09.2026 («хаммаси бирлашиб
    // ковоти»), 03.10.2026 and 05.10.2026. The wide column is the visit's
    // work, top to bottom: «Диагноз», as big as «Назначения» and split in
    // three the same way (owner request, «как назначения сделал сверху, так
    // же диагноз сделай, таким же большим и на три разделённый»), then
    // «Назначения». The conclusion editor that sat there went unused, and
    // the doctor, who works with the mouse, needed the room for the picker
    // columns.
    //
    // The side column holds «Рекомендации» and under it «Контрольный
    // визит» (the card is titled «Данные приёма» before the visit starts):
    // owner request 05.10.2026, «данные приёма переведи под рекомендации».
    // It used to be a column of its own on the left with nothing under the
    // short card; folding it under advice gives that whole track back to
    // the pickers, so two tracks from lg up, the side one fixed. On one
    // column the order is the working order: diagnosis, prescriptions,
    // advice, control visit.
    return (
      <>
        <ConclusionTemplateChannel />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)] xl:gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
            <DiagnosisPanel />
            <PrescriptionsPanel />
          </div>
          <div className="flex min-w-0 flex-col gap-4 self-start xl:gap-5">
            <AdvicePanel />
            <FollowUpPanel />
          </div>
        </div>
      </>
    );
  }

  if (!patientId) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("tabContent.selectPatient")}
      </div>
    );
  }

  // Everything a patient has — diagnoses, visits, and what each visit produced
  // (documents, labs, prescriptions) — now answers from one timeline. The
  // documents/labs/prescriptions tabs were removed; their sections still serve
  // the standalone patient card, where a flat list is the right shape.
  return (
    <div className="flex flex-col gap-4 xl:gap-5">
      <DiagnosisHistoryCard />
      <VisitsSection patientId={patientId} locale={locale} />
    </div>
  );
}
