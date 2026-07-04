"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Public waiting-room board hook for the TV (`/tv`) and lobby surfaces.
 *
 * Replaces the legacy dual-poll of `/api/tv-queue` + `/api/queue/call` with:
 *   - one fetch of `/api/c/[slug]/queue/board` (PII-minimized snapshot), and
 *   - an SSE subscription to `/api/c/[slug]/queue/events` for instant pokes.
 *
 * The SSE stream carries no PHI — it's a signal channel. On any board-mutating
 * event we debounce-refetch the snapshot; on `queue.called` we also surface a
 * `call` object so the TV can chime + announce. A slow poll stays as a safety
 * net in case the stream drops or a poke is missed.
 */

export interface BoardWaiting {
  id: string;
  fullName: string;
  ticketNumber: string;
  queueOrder: number | null;
  etaMinutes: number;
}

export interface BoardCurrent {
  fullName: string;
  /** Null for a booking started without check-in (no queue fields). */
  ticketNumber: string | null;
  startedAt: string | null;
}

export interface BoardDoctor {
  id: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string | null;
  specializationUz: string | null;
  photoUrl: string | null;
  color: string | null;
  cabinet: string | null;
  current: BoardCurrent | null;
  waiting: BoardWaiting[];
}

export interface BoardClinic {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
}

export interface BoardData {
  clinic: BoardClinic;
  now: string;
  doctors: BoardDoctor[];
}

export interface QueueCall {
  appointmentId: string;
  doctorId: string;
  ticketNumber: string | null;
  cabinetNumber: string | null;
  calledAt: string | null;
  queueOrder: number | null;
  /** Bumped on every call so consumers can react even to a re-call. */
  seq: number;
}

const BOARD_REFETCH_DEBOUNCE_MS = 400;
const POLL_FALLBACK_MS = 25_000;

const REFETCH_EVENTS = new Set<string>([
  "queue.updated",
  "queue.called",
  "appointment.created",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
]);

export function useQueueBoard(slug: string) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [call, setCall] = useState<QueueCall | null>(null);
  const [connected, setConnected] = useState(false);

  const callSeq = useRef(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aborter = useRef<AbortController | null>(null);

  const fetchBoard = useCallback(async () => {
    aborter.current?.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const res = await fetch(
        `/api/c/${encodeURIComponent(slug)}/queue/board`,
        { signal: ac.signal, cache: "no-store" },
      );
      if (!res.ok) return;
      setBoard((await res.json()) as BoardData);
    } catch {
      // Aborted or transient network — keep the last board; SSE/poll retries.
    }
  }, [slug]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(fetchBoard, BOARD_REFETCH_DEBOUNCE_MS);
  }, [fetchBoard]);

  // Initial load + slow poll fallback (covers a dropped stream / missed poke).
  useEffect(() => {
    fetchBoard();
    const id = setInterval(fetchBoard, POLL_FALLBACK_MS);
    return () => {
      clearInterval(id);
      clearTimeout(refetchTimer.current);
      aborter.current?.abort();
    };
  }, [fetchBoard]);

  // SSE — instant board pokes + `queue.called` announcements.
  useEffect(() => {
    const es = new EventSource(
      `/api/c/${encodeURIComponent(slug)}/queue/events`,
    );
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // browser auto-reconnects
    es.onmessage = (ev) => {
      let parsed: { type?: string; payload?: Record<string, unknown> };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const type = parsed?.type;
      if (!type || !REFETCH_EVENTS.has(type)) return;
      if (type === "queue.called") {
        const p = parsed.payload ?? {};
        callSeq.current += 1;
        setCall({
          appointmentId: String(p.appointmentId ?? ""),
          doctorId: String(p.doctorId ?? ""),
          ticketNumber: (p.ticketNumber as string) ?? null,
          cabinetNumber: (p.cabinetNumber as string) ?? null,
          calledAt: (p.calledAt as string) ?? null,
          queueOrder: typeof p.queueOrder === "number" ? p.queueOrder : null,
          seq: callSeq.current,
        });
      }
      scheduleRefetch();
    };
    return () => es.close();
  }, [slug, scheduleRefetch]);

  const dismissCall = useCallback(() => setCall(null), []);

  return { board, call, connected, dismissCall };
}
