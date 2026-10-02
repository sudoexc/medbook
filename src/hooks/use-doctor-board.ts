"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Personal doctor TV board hook (`/tv/d/<token>`).
 *
 * Same transport recipe as `useQueueBoard` (snapshot fetch + public SSE pokes
 * + slow-poll safety net), but scoped to ONE doctor:
 *
 *   - snapshot:  GET /api/tv/d/<token>  (token resolves doctor + clinic)
 *   - SSE:       /api/c/<slug>/queue/events — the clinic-wide public signal
 *     stream; events carrying a foreign `doctorId` are ignored, events with
 *     no doctor hint trigger a refetch anyway (cheap and safe).
 *   - `queue.called` for THIS doctor surfaces a `call` object so the screen
 *     can chime + announce; other doctors' calls never fire the overlay. The
 *     call carries the called patient's initials from the event itself
 *     (audit Q-10), since the snapshot lags it (see `resolveCallDisplay`).
 */

export interface DoctorBoardWaiting {
  id: string;
  fullName: string;
  ticketNumber: string;
  etaMinutes: number;
}

export interface DoctorBoardCurrent {
  /** Opaque row key (not the appointment id): lets a call fall back to the right snapshot row. */
  id: string;
  fullName: string;
  /** Null for a booking started without check-in (no queue fields). */
  ticketNumber: string | null;
}

export interface DoctorBoardSlot {
  id: string;
  time: string | null;
  status:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED";
  fullName: string;
}

export interface DoctorBoardData {
  clinic: { slug: string; nameRu: string };
  doctor: {
    id: string;
    nameRu: string;
    specializationRu: string | null;
    color: string | null;
    cabinet: string | null;
  };
  now: string;
  queue: { current: DoctorBoardCurrent | null; waiting: DoctorBoardWaiting[] };
  slots: DoctorBoardSlot[];
}

export interface DoctorCall
  extends Pick<
    QueueCallFields,
    "rowKey" | "ticketNumber" | "cabinetNumber" | "patientName" | "lang"
  > {
  /** Bumped on every call so consumers react even to a re-call. */
  seq: number;
}

import {
  BOARD_POLL_FALLBACK_MS,
  BOARD_REFETCH_DEBOUNCE_MS,
  BOARD_REFETCH_EVENTS,
} from "@/hooks/use-queue-board";
import { eventDoctorIds } from "@/lib/appointments/event-doctors";
import { openBoardEventSource } from "@/lib/board-event-source";
import {
  parseQueueCalledPayload,
  type QueueCallFields,
} from "@/lib/queue-call";

/**
 * How long a refused stream waits before the doctor's TV tries again. Short:
 * this is the screen that calls the doctor's patients, and every call missed
 * while it is closed is a patient who never hears their number.
 */
export const DOCTOR_TV_SSE_REOPEN_MS = 5_000;

/** The doctor TV's event stream URL, carrying its own token as `screen`. */
export function doctorTvEventsUrl(slug: string, token: string): string {
  return `/api/c/${encodeURIComponent(slug)}/queue/events?screen=${encodeURIComponent(token)}`;
}

/**
 * Is a stream event about this door's doctor? Events naming no doctor can't
 * be ruled out; otherwise the doctor must be `doctorId` or, for a visit
 * moved to a colleague, `previousDoctorId` (audit G3-12).
 */
export function boardEventConcerns(
  payload: unknown,
  doctorId: string | null,
): boolean {
  const ids = eventDoctorIds(payload);
  if (ids.length === 0) return true;
  return doctorId !== null && ids.includes(doctorId);
}

export function useDoctorBoard(token: string) {
  const [data, setData] = useState<DoctorBoardData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [call, setCall] = useState<DoctorCall | null>(null);
  const [connected, setConnected] = useState(false);

  const callSeq = useRef(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aborter = useRef<AbortController | null>(null);

  const fetchBoard = useCallback(async () => {
    aborter.current?.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const res = await fetch(`/api/tv/d/${encodeURIComponent(token)}`, {
        signal: ac.signal,
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return;
      setNotFound(false);
      setData((await res.json()) as DoctorBoardData);
    } catch {
      // Aborted or transient network — keep the last board; SSE/poll retries.
    }
  }, [token]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(fetchBoard, BOARD_REFETCH_DEBOUNCE_MS);
  }, [fetchBoard]);

  // Initial load + slow poll fallback.
  useEffect(() => {
    fetchBoard();
    const id = setInterval(fetchBoard, BOARD_POLL_FALLBACK_MS);
    return () => {
      clearInterval(id);
      clearTimeout(refetchTimer.current);
      aborter.current?.abort();
    };
  }, [fetchBoard]);

  // SSE — needs the clinic slug from the snapshot, so it attaches after the
  // first successful fetch and re-attaches only if the slug ever changes.
  const slug = data?.clinic.slug ?? null;
  const doctorId = data?.doctor.id ?? null;
  const doctorIdRef = useRef<string | null>(null);
  useEffect(() => {
    doctorIdRef.current = doctorId;
  }, [doctorId]);

  useEffect(() => {
    if (!slug) return;
    const onMessage = (ev: MessageEvent) => {
      let parsed: { type?: string; payload?: Record<string, unknown> };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const type = parsed?.type;
      if (!type || !BOARD_REFETCH_EVENTS.has(type)) return;
      const p = parsed.payload ?? {};
      const evDoctorId = typeof p.doctorId === "string" ? p.doctorId : null;
      // Foreign doctor's signal: not ours, skip entirely. A visit moved
      // away from this doctor names him as `previousDoctorId` and is ours
      // (G3-12): the patient must leave this door's queue now.
      if (!boardEventConcerns(p, doctorIdRef.current)) return;
      if (type === "queue.called" && evDoctorId === doctorIdRef.current) {
        const c = parseQueueCalledPayload(p);
        callSeq.current += 1;
        setCall({
          rowKey: c.rowKey,
          ticketNumber: c.ticketNumber,
          cabinetNumber: c.cabinetNumber,
          patientName: c.patientName,
          lang: c.lang,
          seq: callSeq.current,
        });
      }
      scheduleRefetch();
    };

    // `screen` marks this as the doctor's own TV, exempt from the per-address
    // stream cap (INF-10): the clinic is one NAT address, and patients on its
    // Wi-Fi following their ticket must not push this screen off the call
    // signal. A refused open (the nginx 502 while the app restarts on a
    // deploy) leaves an EventSource closed for good; the helper reopens it so
    // this screen keeps calling patients without a manual reload.
    return openBoardEventSource(
      doctorTvEventsUrl(slug, token),
      {
        onOpen: () => setConnected(true),
        onError: () => setConnected(false),
        onMessage,
      },
      DOCTOR_TV_SSE_REOPEN_MS,
    );
  }, [slug, token, scheduleRefetch]);

  return { data, notFound, call, connected };
}
