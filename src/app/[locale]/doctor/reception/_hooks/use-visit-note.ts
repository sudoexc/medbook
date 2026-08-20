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

// Ф8 — точка на карте тела; координаты нормированы 0..1 внутри viewBox
// SVG-фигуры. Сохраняется replace-all в VisitNote.bodyMap (Json).
export type BodyMapView = "FRONT" | "BACK";

export type BodyMapPoint = {
  x: number;
  y: number;
  view: BodyMapView;
  label?: string;
};

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
  bodyMap: BodyMapPoint[] | null;
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
  bodyMap: BodyMapPoint[];
  visitPrescriptions: VisitPrescriptionDraft[];
}>;

/**
 * Typed PATCH failure. Carries the HTTP status plus the server's machine
 * `reason` code so callers can tell a version conflict (409, another window
 * saved first) or an expired edit window (403) apart from plain network
 * failures — the three need very different messaging for the doctor.
 * The message keeps the legacy `visit-note patch <status>` shape because
 * existing callers pattern-match on it.
 */
export class VisitNotePatchError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, reason: string | null) {
    super(`visit-note patch ${status}`);
    this.name = "VisitNotePatchError";
    this.status = status;
    this.reason = reason;
  }
}

export function isVersionConflict(e: unknown): boolean {
  return (
    e instanceof VisitNotePatchError &&
    e.status === 409 &&
    e.reason === "version_conflict"
  );
}

export function isEditWindowExpired(e: unknown): boolean {
  return (
    e instanceof VisitNotePatchError &&
    e.status === 403 &&
    e.reason === "edit_window_expired"
  );
}

// Per-note chain of in-flight PATCHes. The server's optimistic lock compares
// the client's `expectedUpdatedAt` token against the stored row, and every
// accepted write bumps `updatedAt` — so two PATCHes from the SAME window
// racing in parallel would make the second one carry a stale token and 409
// spuriously (e.g. autosave firing while a preset chip saves). Serialising
// per note lets each request read the token AFTER the previous response has
// been folded into the cache, so ordinary same-window sequences always pass.
const patchQueues = new Map<string, Promise<unknown>>();

type QueryClientLike = ReturnType<typeof useQueryClient>;

async function sendVisitNotePatch(
  qc: QueryClientLike,
  noteId: string,
  patch: VisitNotePatch,
): Promise<VisitNoteRow> {
  // The freshest revision this window has seen: the cache is updated from
  // every GET and from every PATCH response (below), so this token is our
  // "I edited on top of THIS version" claim. Missing cache row → legacy
  // unversioned write (server skips the check).
  const cached = qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId));
  const expectedUpdatedAt = cached?.updatedAt ?? undefined;
  const res = await fetch(`/api/crm/visit-notes/${noteId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      expectedUpdatedAt ? { ...patch, expectedUpdatedAt } : patch,
    ),
  });
  if (!res.ok) {
    // Best-effort read of the error envelope; the body may be empty or
    // non-JSON on gateway-level failures.
    let reason: string | null = null;
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? null;
    } catch {
      reason = null;
    }
    throw new VisitNotePatchError(res.status, reason);
  }
  const row = (await res.json()) as VisitNoteRow;
  // Fold the fresh row (crucially its new `updatedAt`) into the cache HERE,
  // inside the queued step — react-query's onSuccess runs after the mutation
  // promise settles, which would be too late for the next queued PATCH that
  // reads its version token from the cache.
  qc.setQueryData<VisitNoteRow>(visitNoteKey(row.id), (prev) =>
    prev ? { ...prev, ...row } : row,
  );
  return row;
}

export function usePatchVisitNote(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation<VisitNoteRow, Error, VisitNotePatch>({
    mutationFn: (patch) => {
      if (!noteId) return Promise.reject(new Error("no note id"));
      const prev = patchQueues.get(noteId) ?? Promise.resolve();
      // A failed predecessor must not dam the queue — each request only
      // needs ordering, not the previous result.
      const run = prev.then(
        () => sendVisitNotePatch(qc, noteId, patch),
        () => sendVisitNotePatch(qc, noteId, patch),
      );
      // Store a settled-safe tail so an unhandled rejection never escapes
      // through the map entry.
      patchQueues.set(
        noteId,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
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
