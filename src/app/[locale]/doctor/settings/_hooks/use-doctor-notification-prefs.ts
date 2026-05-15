"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DoctorNotificationPref = {
  id: string;
  userId: string;
  appointmentCreated_inApp: boolean;
  appointmentCreated_email: boolean;
  appointmentCreated_telegram: boolean;
  messageNew_inApp: boolean;
  messageNew_email: boolean;
  messageNew_telegram: boolean;
  labResultReceived_inApp: boolean;
  labResultReceived_email: boolean;
  labResultReceived_telegram: boolean;
  reminderDue_inApp: boolean;
  reminderDue_email: boolean;
  reminderDue_telegram: boolean;
  createdAt: string;
  updatedAt: string;
};

export const notificationPrefsKey = [
  "doctor",
  "me",
  "notification-prefs",
] as const;

export function useDoctorNotificationPrefs() {
  return useQuery<DoctorNotificationPref, Error>({
    queryKey: notificationPrefsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/notification-prefs", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`notification-prefs: ${res.status}`);
      return (await res.json()) as DoctorNotificationPref;
    },
    staleTime: 5 * 60_000,
  });
}

type PrefPatch = Partial<
  Omit<DoctorNotificationPref, "id" | "userId" | "createdAt" | "updatedAt">
>;

export function usePatchDoctorNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation<DoctorNotificationPref, Error, PrefPatch>({
    mutationFn: async (patch) => {
      const res = await fetch("/api/crm/doctors/me/notification-prefs", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`notification-prefs PATCH: ${res.status}`);
      return (await res.json()) as DoctorNotificationPref;
    },
    onSuccess: (data) => {
      // Replace cache with server response so the toggle reflects the
      // authoritative state — no flicker if the user double-clicks.
      qc.setQueryData(notificationPrefsKey, data);
    },
  });
}
