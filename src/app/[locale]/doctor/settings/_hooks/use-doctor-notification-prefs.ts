"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  DOCTOR_NOTIFICATION_PREFS_KEY,
  DOCTOR_NOTIFICATION_PREFS_URL,
  fetchDoctorNotificationPrefs,
  type DoctorNotificationPref,
} from "@/lib/doctor-notification-prefs";

export type { DoctorNotificationPref };

// Shared with the cabinet's message alerts (audit DC-09): a flip written
// here is in that cache at once, so the next message already obeys it.
export const notificationPrefsKey = DOCTOR_NOTIFICATION_PREFS_KEY;

export function useDoctorNotificationPrefs() {
  return useQuery<DoctorNotificationPref, Error>({
    queryKey: notificationPrefsKey,
    queryFn: ({ signal }) => fetchDoctorNotificationPrefs(signal),
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
      const res = await fetch(DOCTOR_NOTIFICATION_PREFS_URL, {
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
