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
import { DEFAULT_VISIT_MIN, tashkentNoonIso } from "@/lib/reception-tablet/doctor-day";
import { readWriteFailure, TabletWriteError } from "@/lib/reception-tablet/errors";
import type { ChosenPatient } from "@/lib/reception-tablet/flow";

/**
 * The tablet's writes, all through the routes the desktop reception uses:
 *   - «В очередь»  → POST /api/crm/appointments/walkin (registerWalkin: the
 *     ticket letter, queue order, duplicate guard and phone-owner rules);
 *   - «Записать»   → POST /api/crm/patients for a new card (same phone-owner
 *     rules), then POST /api/crm/appointments (bookAppointment: no past,
 *     conflicts, schedule), then the case filing of the booking dialog.
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

export type BookInput = {
  patient: ChosenPatient;
  /** A card this flow already created (a retry after a taken slot). */
  createdPatientId: string | null;
  doctorId: string;
  serviceId: string | null;
  /** The chosen service's length with this doctor, minutes. */
  serviceMin: number | null;
  day: string;
  time: string;
  phoneOwner?: PhoneOwnerAnswer;
  /** Told as soon as a new card exists, before the booking is tried. */
  onPatientCreated?: (patientId: string) => void;
};

export function useBookVisit() {
  const qc = useQueryClient();
  const tCase = useTranslations("appointments.case");
  return useMutation<{ id: string; patientId: string }, Error, BookInput>({
    networkMode: "always",
    mutationFn: async (v) => {
      let patientId: string | null =
        v.patient.kind === "existing" ? v.patient.id : v.createdPatientId;

      if (!patientId && v.patient.kind === "new") {
        const res = await fetch("/api/crm/patients", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: v.patient.fullName,
            phone: v.patient.phone,
            ...(v.patient.gender ? { gender: v.patient.gender } : {}),
            // Standing at the desk is how he came, as on the walk-in path.
            source: "WALKIN",
            ...(v.phoneOwner ? { phoneOwner: v.phoneOwner } : {}),
          }),
        });
        const j = (await readJson(res)) as
          | { id?: string; reason?: string; patientId?: string }
          | null;
        if (!res.ok) {
          const owner = readPhoneOwnerMismatch(res.status, j);
          if (owner) throw new PhoneOwnerMismatchError(owner);
          // The same person already has a card (the name matched, or staff
          // answered «тот же человек»): book into it.
          if (res.status === 409 && j?.reason === "phone_already_exists" && j.patientId) {
            patientId = j.patientId;
          } else {
            throw new TabletWriteError(readWriteFailure(res.status, j));
          }
        } else if (j?.id) {
          patientId = j.id;
        }
        if (!patientId) throw new TabletWriteError({ kind: "failed" });
        v.onPatientCreated?.(patientId);
      }
      if (!patientId) throw new TabletWriteError({ kind: "failed" });

      const res = await fetch("/api/crm/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          doctorId: v.doctorId,
          services: v.serviceId ? [{ serviceId: v.serviceId, quantity: 1 }] : [],
          ...(v.serviceId ? { serviceId: v.serviceId } : {}),
          date: tashkentNoonIso(v.day),
          time: v.time,
          // The slot grid sized the block the same way (service length with
          // this doctor, else the grid step).
          durationMin: Math.max(5, v.serviceMin ?? DEFAULT_VISIT_MIN),
          // The booking dialog's desk default; WALKIN is the live lane's.
          channel: "PHONE",
        }),
      });
      if (!res.ok) {
        throw new TabletWriteError(readWriteFailure(res.status, await readJson(res)));
      }
      const created = (await res.json()) as { id: string };

      // Filed into the patient's case the way the booking dialog files it.
      // Soft: a failure here never undoes the booking.
      try {
        await resolveCaseForNewAppointment({
          appointmentId: created.id,
          patientId,
          doctorId: v.doctorId,
          tCase: tCase as unknown as (k: string, v?: Record<string, string | number>) => string,
          // Several open cases: the appointment card asks later.
          openSelector: () => undefined,
        });
      } catch {
        // see above
      }
      return { id: created.id, patientId };
    },
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
