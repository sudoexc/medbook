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
 *   «Назначения» in the middle column, the control visit on the left,
 *   advice on the right (under the left column below 2xl). The conclusion
 *   text has no editor here any more; its preview opens from the sign bar.
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
    // Clinic-requested three-column flow, reworked 29.09.2026 («хаммаси
    // бирлашиб ковоти») and 03.10.2026. The middle column is the visit's
    // work, top to bottom: «Диагноз», as big as «Назначения» and split in
    // three the same way (owner request, «как назначения сделал сверху, так
    // же диагноз сделай, таким же большим и на три разделённый»), then
    // «Назначения». The conclusion editor that sat there went unused, and
    // the doctor, who works with the mouse, needed the room for the picker
    // columns. The left column keeps «Контрольный визит»; advice stays on
    // the right.
    //
    // The left track is narrower than when it held up to four diagnoses
    // (400/420px): only the control visit and, until 2xl, the advice under
    // it live there now, and every pixel it gives back goes to the two
    // three-column pickers in the middle.
    //
    // The third column waits for 2xl. The side tracks are fixed and fill
    // before the middle one, which on this page also loses the 240px
    // sidebar: three columns at xl would leave the middle about 360px on a
    // 1366 laptop and about 270px at 1280, too narrow for the pickers' three
    // columns. Until 2xl
    // the middle spans two rows so advice drops under the short left column
    // instead of under the tall middle one. On one column the order is the
    // working order: diagnosis, prescriptions, control visit, advice.
    return (
      <>
        <ConclusionTemplateChannel />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:gap-5 2xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,300px)] 2xl:grid-rows-none">
          <FollowUpPanel />
          <div className="order-first flex min-w-0 flex-col gap-4 lg:order-none lg:row-span-2 xl:gap-5 2xl:row-span-1">
            <DiagnosisPanel />
            <PrescriptionsPanel />
          </div>
          <AdvicePanel />
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
