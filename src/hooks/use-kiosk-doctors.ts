"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { openBoardEventSource } from "@/lib/board-event-source";
import {
  BOARD_POLL_FALLBACK_MS,
  BOARD_REFETCH_DEBOUNCE_MS,
  BOARD_REFETCH_EVENTS,
} from "@/hooks/use-queue-board";
import {
  mergeKioskDoctors,
  type KioskDoctor,
  type KioskDoctorDetails,
  type QueueDoctorRow,
} from "@/lib/kiosk-flow";

/** How long a refused stream waits before the kiosk tries again. */
const SSE_REOPEN_MS = 30_000;

/**
 * The kiosk's doctor list with live queue lengths (audit Q-07).
 *
 * The kiosk loaded the doctors once, when the page opened at 8:00, and said
 * «0 в очереди, перед вами 0» all day while 15 people waited. Now it keeps
 * the list fresh the way the TV does: the board stream pokes a refetch on
 * every queue change, a slow poll covers a dropped stream, and `refresh()`
 * lets the page reload it whenever a patient reaches the doctor step.
 *
 * Counts come from /api/c/<slug>/queue/doctors (waiting + the one being
 * seen, doctors on duty today); services and this doctor's prices from
 * /api/kiosk/doctors.
 */
export function useKioskDoctors(slug: string): {
  doctors: KioskDoctor[];
  clinicName: string;
  refresh: () => void;
} {
  const [doctors, setDoctors] = useState<KioskDoctor[]>([]);
  const [clinicName, setClinicName] = useState("");
  const aborter = useRef<AbortController | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchDoctors = useCallback(async () => {
    aborter.current?.abort();
    const ac = new AbortController();
    aborter.current = ac;
    const s = encodeURIComponent(slug);
    try {
      const [queueRes, detailsRes] = await Promise.all([
        fetch(`/api/c/${s}/queue/doctors`, { signal: ac.signal, cache: "no-store" }),
        fetch(`/api/kiosk/doctors?c=${s}`, { signal: ac.signal, cache: "no-store" }),
      ]);
      if (!queueRes.ok) return;
      const queue = (await queueRes.json()) as { doctors?: QueueDoctorRow[] };
      const details = detailsRes.ok
        ? ((await detailsRes.json()) as KioskDoctorDetails[])
        : [];
      if (ac.signal.aborted) return;
      setDoctors(mergeKioskDoctors(queue.doctors ?? [], details));
    } catch {
      // Aborted or a network blip: keep the last list; the stream or the
      // poll tries again.
    }
  }, [slug]);

  // The clinic's name for the header logo, once per clinic.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/c/${encodeURIComponent(slug)}/queue/board`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((board: { clinic?: { nameRu?: string } } | null) => {
        if (!cancelled && board?.clinic?.nameRu) setClinicName(board.clinic.nameRu);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(fetchDoctors, BOARD_REFETCH_DEBOUNCE_MS);
  }, [fetchDoctors]);

  // First load (next tick, outside the render's effect pass) + slow poll
  // (a dropped stream or a missed poke).
  useEffect(() => {
    const first = setTimeout(fetchDoctors, 0);
    const id = setInterval(fetchDoctors, BOARD_POLL_FALLBACK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      clearTimeout(refetchTimer.current);
      aborter.current?.abort();
    };
  }, [fetchDoctors]);

  // The same anonymous board stream the TV listens to: PHI-free pokes.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      let type: string | undefined;
      try {
        type = (JSON.parse(ev.data) as { type?: string })?.type;
      } catch {
        return;
      }
      if (type && BOARD_REFETCH_EVENTS.has(type)) scheduleRefetch();
    };
    return openBoardEventSource(
      `/api/c/${encodeURIComponent(slug)}/queue/events`,
      { onOpen: () => undefined, onError: () => undefined, onMessage },
      SSE_REOPEN_MS,
    );
  }, [slug, scheduleRefetch]);

  return { doctors, clinicName, refresh: fetchDoctors };
}
