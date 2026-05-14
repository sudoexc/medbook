"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type VisitNoteRow = {
  id: string;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: "DRAFT" | "FINALIZED";
  startedAt: string | null;
  finalizedAt: string | null;
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  diagnosisCode: string | null;
  diagnosisName: string | null;
  bodyMarkdown: string | null;
  aiGenerated: boolean;
  aiModel: string | null;
  aiTokens: number | null;
  createdAt: string;
  updatedAt: string;
  // Included by the GET endpoint, omitted from PATCH responses.
  patient?: { id: string; fullName: string } | null;
  appointment?: { id: string; date: string; status: string } | null;
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
      qc.setQueryData(visitNoteKey(row.id), row);
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
