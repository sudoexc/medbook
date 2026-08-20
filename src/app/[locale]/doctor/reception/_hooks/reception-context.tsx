"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";

import {
  doctorQueueKey,
  flattenQueue,
  useDoctorQueue,
  type QueueAppointment,
} from "./use-doctor-queue";
import { useEnsureVisitNote, useVisitNote } from "./use-visit-note";

export type ReceptionTab =
  | "session"
  | "history"
  | "documents"
  | "labs"
  | "prescriptions";

type ReceptionContextValue = {
  queue: QueueAppointment[];
  queueLoading: boolean;
  activeAppointment: QueueAppointment | null;
  pickAppointmentId: string | null;
  setPickAppointmentId: (id: string | null) => void;
  visitNoteId: string | null;
  visitNoteLoading: boolean;
  /**
   * Counter bumped whenever the AI rail overwrites `bodyMarkdown` directly.
   * The notes editor watches this so it can re-hydrate from the server even
   * when the note id hasn't changed.
   */
  bodyInjectVersion: number;
  bumpBodyInject: () => void;
  /**
   * One-shot "append this text to the conclusion editor". Set by preset
   * chips; consumed by NotesEditorPanel which appends to its local draft
   * (preserving any unsaved typing) and lets the autosave persist.
   *
   * `nonce` is the discriminator the editor watches — the same `text` value
   * can be requested multiple times by re-bumping the nonce.
   */
  bodyAppendRequest: { text: string; nonce: number } | null;
  requestBodyAppend: (text: string) => void;
  /**
   * Inverse of append — when the doctor removes a structured chip whose
   * preset had a noteTemplate, we strip the corresponding snippet from the
   * conclusion. The editor tries the "\n\n<text>" form first (the form the
   * append channel writes) and falls back to a plain match if the doctor
   * has edited around it.
   */
  bodyRemoveRequest: { text: string; nonce: number } | null;
  requestBodyRemove: (text: string) => void;
  /**
   * Same one-shot append contract as `bodyAppendRequest`, but targeting the
   * patient handout editor (Ф1 — «Вставить в памятку» from the diagnosis
   * guide card). Consumed by HandoutEditor in NotesEditorPanel.
   */
  handoutAppendRequest: { text: string; nonce: number } | null;
  requestHandoutAppend: (text: string) => void;
  /**
   * P0-3 — right after a successful finalize the queue refetch flips the
   * appointment to COMPLETED, `activeAppointment` collapses to null and the
   * card unmounts before the doctor can press «Печать». Pinning keeps the
   * just-finalized appointment active until the doctor explicitly picks
   * another patient or a new visit goes IN_PROGRESS.
   */
  pinFinalizedAppointment: (appointment: QueueAppointment) => void;
  /**
   * P0-2 — editors register a "push unsaved draft to the server now"
   * callback here; finalize awaits `flushDraftEdits()` before POSTing so a
   * debounced autosave tail is never dropped from the legally-final
   * document. Returns an unregister function for effect cleanup.
   */
  registerDraftFlush: (flush: () => Promise<void>) => () => void;
  flushDraftEdits: () => Promise<void>;
  activeTab: ReceptionTab;
  setActiveTab: (t: ReceptionTab) => void;
};

const ReceptionContext = React.createContext<ReceptionContextValue | null>(null);

export function ReceptionProvider({ children }: { children: React.ReactNode }) {
  const queueQuery = useDoctorQueue();
  const queue = flattenQueue(queueQuery.data);

  const inProgress = queue.find((a) => a.status === "IN_PROGRESS") ?? null;

  // The doctor can explicitly select an appointment via Queue card. Default
  // picks the IN_PROGRESS one if it exists.
  const [pickAppointmentId, setPickAppointmentIdState] = React.useState<
    string | null
  >(null);

  // P0-3 — snapshot of the appointment we just finalized. Kept in a ref too
  // so the visit-note effect below can consult it without widening its deps.
  const [pinnedFinalized, setPinnedFinalized] =
    React.useState<QueueAppointment | null>(null);
  const pinnedFinalizedRef = React.useRef<QueueAppointment | null>(null);

  const pinFinalizedAppointment = React.useCallback(
    (appointment: QueueAppointment) => {
      // The queue row still says IN_PROGRESS until the refetch lands —
      // snapshot as COMPLETED so the fallback (row paged out of the queue)
      // still renders the finished state.
      const snapshot = { ...appointment, status: "COMPLETED" as const };
      pinnedFinalizedRef.current = snapshot;
      setPinnedFinalized(snapshot);
    },
    [],
  );

  const clearFinalizedPin = React.useCallback(() => {
    pinnedFinalizedRef.current = null;
    setPinnedFinalized(null);
  }, []);

  // Explicitly choosing another patient releases the pin — the doctor moved on.
  const setPickAppointmentId = React.useCallback(
    (id: string | null) => {
      if (id && id !== pinnedFinalizedRef.current?.id) clearFinalizedPin();
      setPickAppointmentIdState(id);
    },
    [clearFinalizedPin],
  );

  // A new visit going IN_PROGRESS supersedes the pin — the normal "next
  // patient from the queue" flow must win over the frozen finished card.
  React.useEffect(() => {
    if (
      inProgress &&
      pinnedFinalizedRef.current &&
      inProgress.id !== pinnedFinalizedRef.current.id
    ) {
      clearFinalizedPin();
    }
  }, [inProgress, clearFinalizedPin]);

  const activeAppointment = React.useMemo(() => {
    if (pickAppointmentId) {
      return queue.find((a) => a.id === pickAppointmentId) ?? null;
    }
    if (inProgress) return inProgress;
    // P0-3 — no live visit: fall back to the just-finalized one so the
    // finished-visit card (with the print buttons) survives the queue
    // refetch. Prefer the fresh queue row; keep the snapshot if it paged out.
    if (pinnedFinalized) {
      return queue.find((a) => a.id === pinnedFinalized.id) ?? pinnedFinalized;
    }
    return null;
  }, [queue, pickAppointmentId, inProgress, pinnedFinalized]);

  const ensureNote = useEnsureVisitNote();
  const [visitNoteId, setVisitNoteId] = React.useState<string | null>(null);

  // When the active appointment changes (and is IN_PROGRESS), upsert the note.
  React.useEffect(() => {
    if (!activeAppointment || activeAppointment.status !== "IN_PROGRESS") {
      // P0-3 — the pinned just-finalized appointment flips to COMPLETED
      // within a second of finalize; keep its note id so the finished-visit
      // card and the print buttons stay usable.
      if (
        activeAppointment &&
        activeAppointment.id === pinnedFinalizedRef.current?.id
      ) {
        return;
      }
      setVisitNoteId(null);
      return;
    }
    let cancelled = false;
    ensureNote.mutateAsync({ appointmentId: activeAppointment.id }).then(
      (row) => {
        if (!cancelled) setVisitNoteId(row.id);
      },
      () => {
        if (!cancelled) setVisitNoteId(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppointment?.id, activeAppointment?.status]);

  const noteQuery = useVisitNote(visitNoteId);

  const [bodyInjectVersion, setBodyInjectVersion] = React.useState(0);
  const bumpBodyInject = React.useCallback(() => {
    setBodyInjectVersion((v) => v + 1);
  }, []);

  const [bodyAppendRequest, setBodyAppendRequest] = React.useState<
    { text: string; nonce: number } | null
  >(null);
  const requestBodyAppend = React.useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBodyAppendRequest({ text: trimmed, nonce: Date.now() });
  }, []);

  const [bodyRemoveRequest, setBodyRemoveRequest] = React.useState<
    { text: string; nonce: number } | null
  >(null);
  const requestBodyRemove = React.useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBodyRemoveRequest({ text: trimmed, nonce: Date.now() });
  }, []);

  const [handoutAppendRequest, setHandoutAppendRequest] = React.useState<
    { text: string; nonce: number } | null
  >(null);
  const requestHandoutAppend = React.useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setHandoutAppendRequest({ text: trimmed, nonce: Date.now() });
  }, []);

  // P0-2 — flush registry. A Set, not a single slot: the conclusion and the
  // handout editors are both mounted (hidden tabs) and both autosave on a
  // debounce, so finalize must be able to drain both tails.
  const draftFlushesRef = React.useRef(new Set<() => Promise<void>>());
  const registerDraftFlush = React.useCallback(
    (flush: () => Promise<void>) => {
      draftFlushesRef.current.add(flush);
      return () => {
        draftFlushesRef.current.delete(flush);
      };
    },
    [],
  );
  const flushDraftEdits = React.useCallback(async () => {
    // Sequential on purpose — the editors PATCH the same visit-note row and
    // parallel PATCHes would race in last-write-wins order server-side. Any
    // rejection propagates: the caller must abort the finalize.
    for (const flush of Array.from(draftFlushesRef.current)) {
      await flush();
    }
  }, []);

  const [activeTab, setActiveTab] = React.useState<ReceptionTab>("session");

  // Realtime — when any appointment status changes in this clinic, refetch
  // the queue. Cheap because the list endpoint is paginated and cached.
  const qc = useQueryClient();
  useLiveEvents(
    React.useCallback(
      (event) => {
        if (
          event.type === "appointment.statusChanged" ||
          event.type === "appointment.created" ||
          event.type === "appointment.updated" ||
          event.type === "appointment.moved" ||
          event.type === "appointment.cancelled" ||
          event.type === "queue.updated"
        ) {
          qc.invalidateQueries({ queryKey: doctorQueueKey });
        }
      },
      [qc],
    ),
    {
      filter: [
        "appointment.statusChanged",
        "appointment.created",
        "appointment.updated",
        "appointment.moved",
        "appointment.cancelled",
        "queue.updated",
      ],
    },
  );

  const value = React.useMemo<ReceptionContextValue>(
    () => ({
      queue,
      queueLoading: queueQuery.isLoading,
      activeAppointment,
      pickAppointmentId,
      setPickAppointmentId,
      visitNoteId,
      visitNoteLoading: ensureNote.isPending || noteQuery.isLoading,
      bodyInjectVersion,
      bumpBodyInject,
      bodyAppendRequest,
      requestBodyAppend,
      bodyRemoveRequest,
      requestBodyRemove,
      handoutAppendRequest,
      requestHandoutAppend,
      pinFinalizedAppointment,
      registerDraftFlush,
      flushDraftEdits,
      activeTab,
      setActiveTab,
    }),
    [
      queue,
      queueQuery.isLoading,
      activeAppointment,
      pickAppointmentId,
      setPickAppointmentId,
      visitNoteId,
      ensureNote.isPending,
      noteQuery.isLoading,
      bodyInjectVersion,
      bumpBodyInject,
      bodyAppendRequest,
      requestBodyAppend,
      bodyRemoveRequest,
      requestBodyRemove,
      handoutAppendRequest,
      requestHandoutAppend,
      pinFinalizedAppointment,
      registerDraftFlush,
      flushDraftEdits,
      activeTab,
    ],
  );

  return <ReceptionContext.Provider value={value}>{children}</ReceptionContext.Provider>;
}

export function useReceptionContext(): ReceptionContextValue {
  const ctx = React.useContext(ReceptionContext);
  if (!ctx) throw new Error("ReceptionProvider missing");
  return ctx;
}
