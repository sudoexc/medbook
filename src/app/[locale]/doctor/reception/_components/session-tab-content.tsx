"use client";

import { useTranslations } from "next-intl";

import { VisitsSection } from "../../patients/[id]/_components/visits-section";

import { useReceptionContext } from "../_hooks/reception-context";
import { AdvicePanel } from "./advice-panel";
import { DiagnosisHistoryCard } from "./diagnosis-history-card";
import { NotesEditorPanel } from "./notes-editor-panel";
import {
  DiagnosisFollowUpPanel,
  PrescriptionsPanel,
} from "./structured-fields-panel";

/**
 * Tab-driven body of the reception page.
 *
 * - `session` (default) — the live consultation: diagnosis and control
 *   visit on the left, the conclusion editor with «Назначения» under it in
 *   the middle, advice on the right.
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
    // бирлашиб ковоти»): the left column holds only «Диагноз» (up to four)
    // and «Контрольный визит», larger; «Назначения» left it for a card of
    // its own under the conclusion in the middle, where a prescription line
    // fits whole; advice stays on the right.
    //
    // Below xl there is no third column: the middle spans two rows so advice
    // drops under the short left column instead of under the tall middle
    // one. On one column the order is the working order: diagnosis,
    // control visit, conclusion, prescriptions, advice.
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)_minmax(0,300px)] xl:grid-rows-none xl:gap-5">
        <DiagnosisFollowUpPanel />
        <div className="flex min-w-0 flex-col gap-4 lg:row-span-2 xl:row-span-1 xl:gap-5">
          <NotesEditorPanel />
          <PrescriptionsPanel />
        </div>
        <AdvicePanel />
      </div>
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
