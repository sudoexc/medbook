"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  emptyConclusionSections,
  type ConclusionSection,
} from "@/lib/visit-note-sections";

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
  /** Packaging photo joined from the catalog row, when the clinic has one. */
  drug?: { photoUrl: string | null } | null;
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
  /** First signature ever; survives a revert to DRAFT. Starts the 24h clock. */
  firstFinalizedAt: string | null;
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

// Refused or failed PATCHes per note, only ever counted up. A caller that
// waited on the queue compares the count before and after to learn whether
// one of the requests it waited for did not land.
const patchFailures = new Map<string, number>();

/**
 * Fields whose payload is a whole replace-all array the client composes from
 * what it has on screen (audit VW-01). Each is written into the cache the
 * moment the edit is made, so the NEXT action composes on top of it instead
 * of on the render snapshot: «ввёл дозу, кликнул „Утро“» used to send the
 * second PATCH with the old dose, and the server applied it last.
 *
 * Deliberately not the text fields: the conclusion editor keys its
 * «unsaved» state off the cached text, and an optimistic write there would
 * make a failed first save look saved.
 */
export const OPTIMISTIC_FIELDS = [
  "visitPrescriptions",
  "prescriptions",
  "advice",
] as const;
type OptimisticField = (typeof OPTIMISTIC_FIELDS)[number];

// How many queued PATCHes per note still carry each optimistic field. While a
// later one is pending, an earlier response must not put its (older) value
// back into the cache: the doctor would see a chip blink off, and an action
// in that gap would compose on the stale list and erase the pending edit.
const pendingWrites = new Map<string, Map<OptimisticField, number>>();

function bumpPending(
  noteId: string,
  fields: readonly OptimisticField[],
  delta: 1 | -1,
): void {
  if (fields.length === 0) return;
  const counts = pendingWrites.get(noteId) ?? new Map<OptimisticField, number>();
  for (const f of fields) {
    const next = (counts.get(f) ?? 0) + delta;
    if (next > 0) counts.set(f, next);
    else counts.delete(f);
  }
  if (counts.size > 0) pendingWrites.set(noteId, counts);
  else pendingWrites.delete(noteId);
}

function stillPending(noteId: string): Set<string> {
  return new Set(pendingWrites.get(noteId)?.keys() ?? []);
}

/**
 * The cached row with a patch's replace-all fields applied — what the doctor
 * should see (and build the next action on) while the request is in flight.
 * Pure; exported for the unit test.
 */
export function foldPatchIntoRow(
  prev: VisitNoteRow,
  patch: VisitNotePatch,
): VisitNoteRow {
  const next: VisitNoteRow = { ...prev };
  if (patch.prescriptions !== undefined) next.prescriptions = patch.prescriptions;
  if (patch.advice !== undefined) next.advice = patch.advice;
  if (patch.visitPrescriptions !== undefined) {
    const before = prev.visitPrescriptions ?? [];
    next.visitPrescriptions = patch.visitPrescriptions.map((draft, i) => ({
      ...draft,
      // Placeholder identity until the server's replace-all answers with
      // real ids; rows are keyed by position + name on screen, not by id.
      id: before[i]?.id ?? `optimistic-${i}`,
      sortOrder: i,
    }));
  }
  return next;
}

/**
 * Merge a PATCH response over the cached row. The response omits the GET
 * includes (patient, appointment, doctor, clinic), so it is merged, not
 * swapped in; fields named in `keep` stay as cached because a later queued
 * PATCH is about to overwrite them with the doctor's newer intent. Pure;
 * exported for the unit test.
 */
export function mergePatchResponse(
  prev: VisitNoteRow | undefined,
  row: VisitNoteRow,
  keep: ReadonlySet<string>,
): VisitNoteRow {
  if (!prev) return row;
  const next: Record<string, unknown> = { ...prev, ...row };
  for (const field of keep) {
    next[field] = (prev as Record<string, unknown>)[field];
  }
  return next as VisitNoteRow;
}

type QueryClientLike = ReturnType<typeof useQueryClient>;

async function sendVisitNotePatch(
  qc: QueryClientLike,
  noteId: string,
  patch: VisitNotePatch,
  optimistic: readonly OptimisticField[],
): Promise<VisitNoteRow> {
  let settled = false;
  try {
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
    bumpPending(noteId, optimistic, -1);
    settled = true;
    // Fold the fresh row (crucially its new `updatedAt`) into the cache HERE,
    // inside the queued step — react-query's onSuccess runs after the mutation
    // promise settles, which would be too late for the next queued PATCH that
    // reads its version token from the cache.
    const keep = stillPending(noteId);
    qc.setQueryData<VisitNoteRow>(visitNoteKey(row.id), (prev) =>
      mergePatchResponse(prev, row, keep),
    );
    return row;
  } finally {
    if (!settled) bumpPending(noteId, optimistic, -1);
  }
}

/**
 * Queue one PATCH for a note. Not a hook, so the unit test can drive the real
 * ordering and cache behaviour with a bare QueryClient. The replace-all
 * fields are written into the cache synchronously, before the request is
 * even queued, so whatever the doctor does next is built on this edit.
 */
export function enqueueVisitNotePatch(
  qc: QueryClientLike,
  noteId: string,
  patch: VisitNotePatch,
): Promise<VisitNoteRow> {
  const optimistic = OPTIMISTIC_FIELDS.filter((f) => patch[f] !== undefined);
  if (optimistic.length > 0) {
    qc.setQueryData<VisitNoteRow>(visitNoteKey(noteId), (prev) =>
      prev ? foldPatchIntoRow(prev, patch) : prev,
    );
    bumpPending(noteId, optimistic, 1);
  }
  const prev = patchQueues.get(noteId) ?? Promise.resolve();
  // A failed predecessor must not dam the queue — each request only needs
  // ordering, not the previous result.
  const send = () => sendVisitNotePatch(qc, noteId, patch, optimistic);
  const run = prev.then(send, send);
  // Store a settled-safe tail so an unhandled rejection never escapes
  // through the map entry. The failure is counted inside the tail, so it is
  // recorded before anyone awaiting the tail resumes.
  patchQueues.set(
    noteId,
    run.then(
      () => undefined,
      () => {
        patchFailures.set(noteId, (patchFailures.get(noteId) ?? 0) + 1);
      },
    ),
  );
  return run;
}

/**
 * Resolves once every PATCH queued for this note so far has answered: true
 * when all of them were accepted, false when one was refused or failed.
 * An idle note resolves true at once.
 *
 * For whatever must act on what the server holds rather than on what the
 * screen shows. The finalize POST does not go through the queue, so a
 * signature sent while a correction is still queued reaches the server
 * first: the signed revision lacks the correction, which then fails as a
 * stale version and vanishes from the screen.
 */
export async function settleVisitNotePatches(noteId: string): Promise<boolean> {
  const failedBefore = patchFailures.get(noteId) ?? 0;
  await patchQueues.get(noteId);
  return (patchFailures.get(noteId) ?? 0) === failedBefore;
}

export type SignReadiness =
  | { kind: "unsaved" }
  | { kind: "ready"; row: VisitNoteRow; missing: ConclusionSection[] };

/**
 * The steps before a signature, in order: wait for every queued correction,
 * then read the row back from the server and check it for empty sections.
 * The cache is not good enough for that check: it already holds the
 * optimistic replace-all rows (VW-01), so a drug whose save is still in
 * flight, or is about to fail, would count as prescribed. "unsaved" means a
 * queued correction did not land and nothing should be signed until the
 * doctor has seen the card snap back.
 */
export async function prepareVisitNoteSignature(
  noteId: string,
  readSavedRow: () => Promise<VisitNoteRow>,
): Promise<SignReadiness> {
  if (!(await settleVisitNotePatches(noteId))) return { kind: "unsaved" };
  const row = await readSavedRow();
  const missing = emptyConclusionSections({
    ...row,
    structuredRx: row.visitPrescriptions?.length ?? 0,
  });
  return { kind: "ready", row, missing };
}

export function usePatchVisitNote(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation<VisitNoteRow, Error, VisitNotePatch>({
    // A replace-all save must never sit paused because the browser thinks it
    // is offline: its cache edit is already applied, and the doctor's next
    // action would be composed on a list the server has not seen. Better to
    // try, fail loudly and let the caller snap the card back.
    networkMode: "always",
    mutationFn: (patch) => {
      if (!noteId) return Promise.reject(new Error("no note id"));
      return enqueueVisitNotePatch(qc, noteId, patch);
    },
    onSuccess: (row) => {
      // The row is already merged into the cache inside the queued step
      // (with the pending-field guard). Merging it again here, after the
      // promise settles, could put back a value a later PATCH has replaced.
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
      // Merged: the finalize response carries no includes (patient,
      // appointment, prescription rows), and the conclusion card that can
      // now sign a draft (DC-01) would blank them until the refetch lands.
      qc.setQueryData<VisitNoteRow>(visitNoteKey(note.id), (prev) =>
        prev ? { ...prev, ...note } : note,
      );
      qc.invalidateQueries({ queryKey: ["doctor", "reception"] });
    },
  });
}
