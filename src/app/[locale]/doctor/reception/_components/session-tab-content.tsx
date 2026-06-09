"use client";

import { useTranslations } from "next-intl";

import { VisitsSection } from "../../patients/[id]/_components/visits-section";
import { DocumentsSection } from "../../patients/[id]/_components/documents-section";
import { PrescriptionsSection } from "../../patients/[id]/_components/prescriptions-section";
import { LabsSection } from "../../patients/[id]/_components/labs-section";

import { useReceptionContext } from "../_hooks/reception-context";
import { NotesEditorPanel } from "./notes-editor-panel";
import { StructuredFieldsPanel } from "./structured-fields-panel";

/**
 * Tab-driven body of the reception page.
 *
 * - `session` (default) — the live consultation editor: structured fields on
 *   the left, the bodyMarkdown editor on the right.
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
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:gap-5">
        <StructuredFieldsPanel />
        <NotesEditorPanel />
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

  if (activeTab === "history") {
    return <VisitsSection patientId={patientId} locale={locale} />;
  }
  if (activeTab === "documents") {
    return <DocumentsSection patientId={patientId} />;
  }
  if (activeTab === "labs") {
    return <LabsSection patientId={patientId} />;
  }
  return <PrescriptionsSection patientId={patientId} />;
}
