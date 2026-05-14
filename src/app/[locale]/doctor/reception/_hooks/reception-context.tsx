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
  const [pickAppointmentId, setPickAppointmentId] = React.useState<string | null>(
    null,
  );

  const activeAppointment = React.useMemo(() => {
    if (pickAppointmentId) {
      return queue.find((a) => a.id === pickAppointmentId) ?? null;
    }
    return inProgress;
  }, [queue, pickAppointmentId, inProgress]);

  const ensureNote = useEnsureVisitNote();
  const [visitNoteId, setVisitNoteId] = React.useState<string | null>(null);

  // When the active appointment changes (and is IN_PROGRESS), upsert the note.
  React.useEffect(() => {
    if (!activeAppointment || activeAppointment.status !== "IN_PROGRESS") {
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
      activeTab,
      setActiveTab,
    }),
    [
      queue,
      queueQuery.isLoading,
      activeAppointment,
      pickAppointmentId,
      visitNoteId,
      ensureNote.isPending,
      noteQuery.isLoading,
      bodyInjectVersion,
      bumpBodyInject,
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
