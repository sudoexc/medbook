/**
 * Where a chart read happened, for PatientView rows (audit G1-06) and the
 * «Просмотры карточек» filter (G1-10). Client-safe: the audit screen and the
 * server helper share the one list.
 */
export const PATIENT_VIEW_CONTEXTS = [
  "patient.detail",
  "appointment.drawer",
  "case.detail",
  "visit_note",
  "visit_note.print",
  "document.file",
  "conversation",
  "doctor.card",
  "doctor.current",
  "doctor.visit",
  "export",
] as const;

export type PatientViewContext = (typeof PATIENT_VIEW_CONTEXTS)[number];

/** The `settings.audit.patientView.*` message key for a context. */
export const PATIENT_VIEW_CONTEXT_LABEL: Record<PatientViewContext, string> = {
  "patient.detail": "contextPatientDetail",
  "appointment.drawer": "contextAppointmentDrawer",
  "case.detail": "contextCaseDetail",
  visit_note: "contextVisitNote",
  "visit_note.print": "contextVisitNotePrint",
  "document.file": "contextDocumentFile",
  conversation: "contextConversation",
  "doctor.card": "contextDoctorCard",
  "doctor.current": "contextDoctorCurrent",
  "doctor.visit": "contextDoctorVisit",
  export: "contextExport",
};
