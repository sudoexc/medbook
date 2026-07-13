"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
// The route module owns the wire types (TZ-risk-outcomes §6). Type-only
// import — nothing server-side leaks into the client bundle.
import type {
  HandledRow,
  RiskReason,
  RiskTodayResponse,
  RiskTodayRow,
} from "@/app/api/crm/action-center/risk-today/route";

// Re-exported so the widget keeps importing every risk-today type from this
// hook instead of reaching into the API route directly.
export type { HandledRow, RiskReason, RiskTodayResponse, RiskTodayRow };

/** The six call outcomes of TZ-risk-outcomes §1 — mirrors ActionOutcomeEnum. */
export type RiskOutcome =
  | "CONFIRMED"
  | "RESCHEDULED"
  | "CALLBACK"
  | "RETURN_LATER"
  | "REFUSED"
  | "NO_ANSWER";

export const RISK_TODAY_KEY = ["action-center", "risk-today"] as const;

export function useRiskToday() {
  const q = useQuery<RiskTodayResponse, Error>({
    queryKey: RISK_TODAY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/action-center/risk-today`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as RiskTodayResponse;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  // Invalidate on Action and Appointment changes so the triage stays warm
  // without the receptionist having to refresh.
  useLiveQueryInvalidation({
    events: [
      "action.created",
      "action.updated",
      "appointment.created",
      "appointment.updated",
    ],
    queryKey: RISK_TODAY_KEY,
  });

  return q;
}

// Must mirror the server's per-row loss formula in route.ts:
//   estimatedLossTiins += (priceFinal ?? FALLBACK) * riskScore
// otherwise the «X сум до потери» chip stays stuck at the original total
// until the next refetch.
const FALLBACK_PRICE_TIINS = 8_000_000;

/**
 * Optimistically drop one row from the cached risk-today response so the UI
 * feels instant. Shared by the outcome mutation below and the widget's
 * snooze path; server-driven invalidation re-syncs afterwards.
 */
export function dropRiskRowFromCache(
  qc: QueryClient,
  appointmentId: string,
  countsHandled: boolean,
) {
  qc.setQueryData<RiskTodayResponse>(RISK_TODAY_KEY, (prev) => {
    if (!prev) return prev;
    const target = prev.appointments.find(
      (a) => a.appointmentId === appointmentId,
    );
    if (!target) return prev;
    const next = prev.appointments.filter(
      (a) => a.appointmentId !== appointmentId,
    );
    const droppedLoss = Math.round(
      (target.priceFinalTiins ?? FALLBACK_PRICE_TIINS) * target.riskScore,
    );
    return {
      ...prev,
      appointments: next,
      totals: {
        ...prev.totals,
        open: next.length,
        handledToday: prev.totals.handledToday + (countsHandled ? 1 : 0),
        estimatedLossTiins: Math.max(
          0,
          prev.totals.estimatedLossTiins - droppedLoss,
        ),
      },
    };
  });
}

export type RecordOutcomeInput = {
  /** Every open Action attached to the row — the outcome is stamped on each,
   *  same as the old «Обработано» done-loop. */
  actionIds: string[];
  /** Drives the optimistic cache drop; not sent to the server. */
  appointmentId: string;
  outcome: RiskOutcome;
  /** Free text: refusal reason / callback context. */
  note?: string;
  /** ISO datetime — REQUIRED for CALLBACK / RETURN_LATER (schema-enforced). */
  callbackAt?: string;
};

/**
 * Records what a risk-today call actually resolved to (TZ-risk-outcomes §4).
 * Supersedes the bare done-loop for risk rows: the endpoint drives the right
 * durable domain action per outcome (confirm / cancel / snooze / attempts),
 * so a handled row stops bouncing back on the 15-min engine recompute.
 */
export function useRecordOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordOutcomeInput) => {
      const body = JSON.stringify({
        outcome: input.outcome,
        ...(input.note ? { note: input.note } : {}),
        ...(input.callbackAt ? { callbackAt: input.callbackAt } : {}),
      });
      // One outcome per Action; a risk row can carry several detector rows
      // (NO_SHOW_RISK_HIGH + UNCONFIRMED_24H) — post to each id.
      await Promise.all(
        input.actionIds.map(async (id) => {
          const res = await fetch(`/api/crm/actions/${id}/outcome`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as
              | { error?: string; reason?: string }
              | null;
            throw new Error(data?.reason ?? data?.error ?? `HTTP ${res.status}`);
          }
        }),
      );
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: RISK_TODAY_KEY });
      dropRiskRowFromCache(qc, input.appointmentId, true);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
      // The outcome also closed/snoozed the underlying Action rows — keep the
      // Action Center lists in sync too.
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

/**
 * Marks a patient as "contacted now" by stamping `Patient.lastContactedAt`.
 * Used by the risk-today section when a row's only reason is `no_contact`
 * (no detector Action attached) — without this, clicking "Обработано"
 * just invalidated the cache and the row came right back on refetch.
 */
export function useMarkPatientContacted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; appointmentId?: string }) => {
      const res = await fetch(`/api/crm/action-center/mark-contacted`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; reason?: string }
          | null;
        throw new Error(data?.reason ?? data?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as {
        patientId: string;
        lastContactedAt: string;
      };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: RISK_TODAY_KEY });
    },
  });
}
