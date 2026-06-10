"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type VisitPrescriptionTimeOfDay =
  | "MORNING"
  | "NOON"
  | "EVENING"
  | "NIGHT";

export type VisitPrescriptionMealRelation =
  | "BEFORE_MEAL"
  | "WITH_MEAL"
  | "AFTER_MEAL"
  | "EMPTY_STOMACH"
  | "NO_MATTER";

// Ф2 — structured prescription row as stored. The PATCH payload sends drafts
// (no id/sortOrder — replace-all, sortOrder = array index server-side).
export type VisitPrescriptionRow = {
  id: string;
  drugId: string | null;
  displayName: string;
  form: string | null;
  strength: string | null;
  dose: string;
  timesOfDay: VisitPrescriptionTimeOfDay[];
  mealRelation: VisitPrescriptionMealRelation;
  durationDays: number | null;
  instructionRu: string | null;
  instructionUz: string | null;
  remindPatient: boolean;
  sortOrder: number;
};

export type VisitPrescriptionDraft = Omit<
  VisitPrescriptionRow,
  "id" | "sortOrder"
>;

export type VisitNoteRow = {
  id: string;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: "DRAFT" | "FINALIZED";
  startedAt: string | null;
  finalizedAt: string | null;
  documentNumber: string | null;
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  diagnosisCode: string | null;
  diagnosisName: string | null;
  bodyMarkdown: string | null;
  patientHandoutMarkdown: string | null;
  followUpDays: number | null;
  followUpNote: string | null;
  dynamics: "IMPROVED" | "STABLE" | "WORSE" | null;
  dynamicsNote: string | null;
  aiGenerated: boolean;
  aiModel: string | null;
  aiTokens: number | null;
  createdAt: string;
  updatedAt: string;
  // Ф2 — included by GET and PATCH (PATCH returns the fresh replace-all set).
  visitPrescriptions?: VisitPrescriptionRow[];
  // Included by the GET endpoint, omitted from PATCH responses.
  patient?: { id: string; fullName: string } | null;
  appointment?: { id: string; date: string; status: string } | null;
  doctor?: {
    specializationRu: string | null;
    specializationUz: string | null;
    user: { name: string | null };
  } | null;
  clinic?: { nameRu: string | null; nameUz: string | null } | null;
};

export const visitNoteKey = (id: string | null) =>
  ["doctor", "reception", "visit-note", id ?? ""] as const;

/** Upsert by appointmentId — server returns the existing row or creates a fresh DRAFT. */
export function useEnsureVisitNote() {
  const qc = useQueryClient();
  return useMutation<VisitNoteRow, Error, { appointmentId: string }>({
    mutationFn: async ({ appointmentId }) => {
      const res = await fetch("/api/crm/visit-notes", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      if (!res.ok) throw new Error(`visit-notes ${res.status}`);
      return (await res.json()) as VisitNoteRow;
    },
    onSuccess: (row) => {
      qc.setQueryData(visitNoteKey(row.id), row);
    },
  });
}

export function useVisitNote(noteId: string | null) {
  return useQuery<VisitNoteRow>({
    queryKey: visitNoteKey(noteId),
    enabled: !!noteId,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/visit-notes/${noteId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`visit-note ${res.status}`);
      return (await res.json()) as VisitNoteRow;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

export type VisitNotePatch = Partial<{
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  diagnosisCode: string | null;
  diagnosisName: string | null;
  bodyMarkdown: string | null;
  patientHandoutMarkdown: string | null;
  followUpDays: number | null;
  followUpNote: string | null;
  dynamics: "IMPROVED" | "STABLE" | "WORSE" | null;
  dynamicsNote: string | null;
  visitPrescriptions: VisitPrescriptionDraft[];
}>;

export function usePatchVisitNote(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation<VisitNoteRow, Error, VisitNotePatch>({
    mutationFn: async (patch) => {
      if (!noteId) throw new Error("no note id");
      const res = await fetch(`/api/crm/visit-notes/${noteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`visit-note patch ${res.status}`);
      return (await res.json()) as VisitNoteRow;
    },
    onSuccess: (row) => {
      // Merge over the cached GET row — the PATCH response carries the fresh
      // scalar fields + visitPrescriptions but omits the patient/appointment/
      // doctor/clinic includes; a plain replace would blank them until refetch.
      qc.setQueryData<VisitNoteRow>(visitNoteKey(row.id), (prev) =>
        prev ? { ...prev, ...row } : row,
      );
      qc.invalidateQueries({ queryKey: ["doctor", "reception", "warnings", row.id] });
    },
  });
}

export function useFinalizeVisitNote(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation<
    { note: VisitNoteRow; appointment: { id: string; status: string } | unknown },
    Error,
    void
  >({
    mutationFn: async () => {
      if (!noteId) throw new Error("no note id");
      const res = await fetch(`/api/crm/visit-notes/${noteId}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`visit-note finalize ${res.status}`);
      return (await res.json()) as {
        note: VisitNoteRow;
        appointment: { id: string; status: string };
      };
    },
    onSuccess: ({ note }) => {
      qc.setQueryData(visitNoteKey(note.id), note);
      qc.invalidateQueries({ queryKey: ["doctor", "reception"] });
    },
  });
}
