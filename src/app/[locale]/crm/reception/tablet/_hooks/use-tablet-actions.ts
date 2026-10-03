"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  PhoneOwnerMismatchError,
  readPhoneOwnerMismatch,
  type PhoneOwnerAnswer,
} from "@/components/appointments/phone-owner-prompt";
import { resolveCaseForNewAppointment } from "@/components/appointments/NewAppointmentDialog";
import { effectiveServiceTerms } from "@/lib/doctor-service-terms";
import {
  bookVisit,
  writeSignal,
  type BookedVisit,
  type BookInput,
} from "@/lib/reception-tablet/book-visit";
import { tashkentNoonIso } from "@/lib/reception-tablet/doctor-day";
import { readWriteFailure, TabletWriteError } from "@/lib/reception-tablet/errors";
import type { ChosenPatient } from "@/lib/reception-tablet/flow";

/**
 * The tablet's writes, all through the routes the desktop reception uses:
 *   - «В очередь»  → POST /api/crm/appointments/walkin (registerWalkin: the
 *     ticket letter, queue order, duplicate guard and phone-owner rules);
 *   - «Записать»   → bookVisit (book-visit.ts): POST /api/crm/patients for a
 *     new card (same phone-owner rules), then POST /api/crm/appointments
 *     (bookAppointment: no past, conflicts, schedule), then the case filing
 *     of the booking dialog. After a booking that got no answer, the next
 *     try first looks the visit up so the patient is never booked twice.
 * Every write times out on its own (`writeSignal`, 40 s).
 * «Пришёл» reuses `useSetQueueStatus` of the appointment card as is.
 */

function invalidateDesk(qc: ReturnType<typeof useQueryClient>) {
  const opts = { refetchType: "active" } as const;
  qc.invalidateQueries({ queryKey: ["reception"], ...opts });
  qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
  qc.invalidateQueries({ queryKey: ["appointments", "slots"], ...opts });
  qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
  qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** What POST /api/crm/appointments/walkin answers (201). */
export type WalkinIssued = {
  appointmentId: string;
  duplicate?: boolean;
  ticketCode: string | null;
  ticketNumber: string;
  queueOrder: number;
  patient: { id: string; fullName: string };
  doctor: { id: string; nameRu: string; nameUz: string; color: string | null };
  cabinet: string | null;
};

export type WalkinInput = {
  patient: ChosenPatient;
  doctorId: string;
  serviceId: string | null;
  phoneOwner?: PhoneOwnerAnswer;
};

export function useIssueWalkin() {
  const qc = useQueryClient();
  return useMutation<WalkinIssued, Error, WalkinInput>({
    // A dropped connection must say so at once, not sit «paused» until the
    // Wi-Fi returns and then fire a ticket nobody is waiting for.
    networkMode: "always",
    mutationFn: async ({ patient, doctorId, serviceId, phoneOwner }) => {
      const body: Record<string, unknown> =
        patient.kind === "existing"
          ? { doctorId, patientId: patient.id }
          : {
              doctorId,
              newPatient: {
                fullName: patient.fullName,
                phone: patient.phone,
                ...(phoneOwner ? { phoneOwner } : {}),
                ...(patient.gender ? { gender: patient.gender } : {}),
              },
            };
      if (serviceId) body.serviceId = serviceId;
      const res = await fetch("/api/crm/appointments/walkin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: writeSignal(),
      });
      if (!res.ok) {
        const j = await readJson(res);
        const owner = readPhoneOwnerMismatch(res.status, j);
        if (owner) throw new PhoneOwnerMismatchError(owner);
        throw new TabletWriteError(readWriteFailure(res.status, j));
      }
      return (await res.json()) as WalkinIssued;
    },
    onSuccess: () => invalidateDesk(qc),
  });
}

export type { BookedVisit, BookInput } from "@/lib/reception-tablet/book-visit";

export function useBookVisit() {
  const qc = useQueryClient();
  const tCase = useTranslations("appointments.case");
  return useMutation<BookedVisit, Error, BookInput>({
    networkMode: "always",
    mutationFn: (v) =>
      bookVisit(v, {
        // Filed into the patient's case the way the booking dialog files it.
        // Soft: a failure here never undoes the booking.
        fileIntoCase: async (appointmentId, patientId, doctorId) => {
          try {
            await resolveCaseForNewAppointment({
              appointmentId,
              patientId,
              doctorId,
              tCase: tCase as unknown as (k: string, v?: Record<string, string | number>) => string,
              // Several open cases: the appointment card asks later.
              openSelector: () => undefined,
            });
          } catch {
            // see above
          }
        },
      }),
    onSuccess: () => invalidateDesk(qc),
  });
}

/** A patient search hit: the list endpoint's row, the fields the tablet shows. */
export type TabletPatientHit = {
  id: string;
  fullName: string;
  phone: string | null;
  phoneNormalized: string | null;
  birthDate: string | null;
  lastVisitAt: string | null;
  photoUrl: string | null;
};

/** Search by phone digits, name or «Фамилия ГГГГ» (the server's rules). */
export function useTabletPatientSearch(term: string | null) {
  return useQuery<TabletPatientHit[], Error>({
    queryKey: ["reception-tablet", "patients", term],
    enabled: Boolean(term),
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({
        q: term!,
        limit: "12",
        sort: "lastVisitAt",
        dir: "desc",
      });
      const res = await fetch(`/api/crm/patients?${qs.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: TabletPatientHit[] };
      return j.rows;
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** A service the doctor offers, priced and timed as he does it. */
export type TabletService = {
  id: string;
  nameRu: string;
  nameUz: string;
  price: number;
  durationMin: number;
};

type DoctorDetail = {
  id: string;
  services: Array<{
    serviceId: string;
    priceOverride: number | null;
    durationMinOverride: number | null;
    service: {
      id: string;
      nameRu: string;
      nameUz: string;
      priceBase: number;
      durationMin: number;
      isActive: boolean;
    } | null;
  }>;
};

/** The doctor's active services (GET /api/crm/doctors/[id]). */
export function useDoctorServices(doctorId: string | null) {
  return useQuery<TabletService[], Error>({
    queryKey: ["reception-tablet", "doctor-services", doctorId],
    enabled: Boolean(doctorId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as DoctorDetail;
      return (d.services ?? [])
        .filter((l) => l.service && l.service.isActive)
        .map((l) => {
          const s = l.service!;
          const terms = effectiveServiceTerms(s, l);
          return {
            id: s.id,
            nameRu: s.nameRu,
            nameUz: s.nameUz,
            price: terms.price,
            durationMin: terms.durationMin,
          };
        })
        .sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
    },
    staleTime: 5 * 60_000,
  });
}

/** Free slots of one doctor on one day (GET /appointments/slots/available). */
export function useTabletSlots(args: {
  doctorId: string | null;
  day: string | null;
  serviceId: string | null;
}) {
  const { doctorId, day, serviceId } = args;
  return useQuery<{ slots: string[]; slotMin: number }, Error>({
    // Under ["appointments","slots"] so every booking anywhere refreshes it.
    queryKey: ["appointments", "slots", "tablet", doctorId, day, serviceId ?? ""],
    enabled: Boolean(doctorId && day),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("doctorId", doctorId!);
      params.set("date", tashkentNoonIso(day!));
      if (serviceId) params.append("serviceIds", serviceId);
      const res = await fetch(`/api/crm/appointments/slots/available?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { slots: string[]; slotMin: number };
    },
    // A live grid: a slot taken on another screen must not look free.
    staleTime: 0,
  });
}

/**
 * One submit at a time, even for two taps landing in the same frame
 * (React state would still read «not pending» for the second one).
 */
export function useSubmitLock(): (run: () => Promise<unknown> | void) => void {
  const busy = React.useRef(false);
  return React.useCallback((run) => {
    if (busy.current) return;
    busy.current = true;
    Promise.resolve()
      .then(run)
      .finally(() => {
        busy.current = false;
      });
  }, []);
}
