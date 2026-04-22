"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AppointmentConflictError,
  type AppointmentConflict,
  type AppointmentPatchInput,
  appointmentKey,
} from "../../appointments/_hooks/use-appointment";

export type ConflictState = AppointmentConflict & { appointmentId: string };

/**
 * Centralises optimistic PATCH + 409 handling for the calendar.
 *
 * Returns:
 *  - `mutate({id, patch, onConflict, onSuccess})` — performs optimistic update
 *    against the `calendar` query cache; on 409 rolls back and calls
 *    `onConflict(conflict)`.
 *  - `lastConflict` — the last conflict surfaced (for banner rendering).
 *  - `clearConflict()` — clear the banner.
 */
export function useConflictDetector() {
  const qc = useQueryClient();
  const [lastConflict, setLastConflict] =
    React.useState<ConflictState | null>(null);

  const mutation = useMutation<
    void,
    Error,
    {
      id: string;
      patch: AppointmentPatchInput;
      onConflict?: (c: AppointmentConflict) => void;
      onSuccess?: () => void;
    }
  >({
    mutationFn: async ({ id, patch }) => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          until?: string;
        } | null;
        throw new AppointmentConflictError({
          reason:
            (j?.reason as AppointmentConflict["reason"]) ?? "doctor_busy",
          until: j?.until,
        });
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (err, variables) => {
      if (err instanceof AppointmentConflictError) {
        setLastConflict({ ...err.conflict, appointmentId: variables.id });
        variables.onConflict?.(err.conflict);
      }
    },
    onSuccess: (_data, variables) => {
      setLastConflict(null);
      variables.onSuccess?.();
    },
    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: ["calendar", "appointments"] });
      qc.invalidateQueries({ queryKey: appointmentKey(variables.id) });
    },
  });

  const clearConflict = React.useCallback(() => setLastConflict(null), []);

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    lastConflict,
    clearConflict,
  } as const;
}
