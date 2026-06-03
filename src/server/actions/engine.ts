/**
 * Action Center engine — Phase 13 Wave 2.
 *
 * Orchestrates the 10 pure detectors, persists their output via the Wave-1
 * `upsertAction` repository, sweeps stale rows, and publishes realtime
 * `action.created` / `action.updated` events.
 *
 * Caller contract:
 *   - The scheduler is responsible for wrapping each clinic in
 *     `runWithTenant({ kind: "TENANT", clinicId, ... })` before invoking
 *     `runActionEngine`. The engine itself is tenant-context-agnostic — it
 *     accepts an injected `prisma` (which may already be tenant-scoped).
 *   - Detector failures are isolated via `Promise.allSettled` so one bad
 *     detector does not poison the rest of the recompute pass.
 *   - Severity overrides come from per-detector helpers (e.g.
 *     `severityForUnconfirmed24h`) — see each detector file.
 *   - `expiresAt` is set explicitly for volatile signals so `expireStaleActions`
 *     can sweep them without needing the 48h `updatedAt` fallback.
 */
import type {
  ActionPayload,
  ActionSeverity,
  ActionType,
} from "@/lib/actions/types";
import { defaultSeverity } from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";
import { publishEvent } from "@/server/realtime/publish";

import { DEFAULT_CONFIG, type DetectorConfig } from "./config";
import { expireStaleActions, upsertAction } from "./repository";
import { detectCaseRepeatDue } from "./detectors/case-repeat-due";
import { detectDoctorOverload } from "./detectors/doctor-overload";
import { detectDormantBatch } from "./detectors/dormant-batch";
import {
  detectEmptySlotTomorrow,
  severityForEmptySlot,
} from "./detectors/empty-slot-tomorrow";
import { detectIdleRoom } from "./detectors/idle-room";
import {
  detectNoShowRiskHigh,
  severityForNoShowRisk,
} from "./detectors/no-show-risk-high";
import { detectLowDoctorSchedule } from "./detectors/low-doctor-schedule";
import { detectOverdueFollowUp } from "./detectors/overdue-follow-up";
import {
  detectPaymentOverdue,
  severityForPaymentOverdue,
} from "./detectors/payment-overdue";
import {
  detectUnconfirmed24h,
  severityForUnconfirmed24h,
} from "./detectors/unconfirmed-24h";

// Narrowed from `TenantScopedPrisma | PrismaClient` — TS couldn't unify
// the overload signatures (TS2349). Engine runs with the extended client.
type PrismaLike = TenantScopedPrisma;

export type DetectorRun = {
  type: ActionType;
  payloads: ActionPayload[];
  severityFor?: (payload: ActionPayload, now: Date) => ActionSeverity;
  expiresAtFor?: (payload: ActionPayload, now: Date) => Date | null | undefined;
};

export type EngineResult = {
  created: number;
  updated: number;
  skipped: number;
  expired: number;
  errors: Array<{ type: ActionType; error: string }>;
};

const VOLATILE_TTL_MS = 30 * 60 * 1000;

function expiresInThirtyMin(_p: unknown, now: Date): Date {
  return new Date(now.getTime() + VOLATILE_TTL_MS);
}

/**
 * Run every detector once, fan out to `upsertAction`, then sweep stale rows.
 * Errors from individual detectors are captured in the result; the function
 * always returns a populated summary.
 */
export async function runActionEngine(
  prisma: PrismaLike,
  clinicId: string,
  now: Date = new Date(),
  config: DetectorConfig = DEFAULT_CONFIG,
): Promise<EngineResult> {
  const result: EngineResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    expired: 0,
    errors: [],
  };

  type Spec = {
    type: ActionType;
    run: () => Promise<ActionPayload[]>;
    severityFor?: (payload: ActionPayload, now: Date) => ActionSeverity;
    expiresAtFor?: (payload: ActionPayload, now: Date) => Date | null | undefined;
    deeplinkPathFor?: (payload: ActionPayload) => string;
  };

  const specs: Spec[] = [
    {
      type: "EMPTY_SLOT_TOMORROW",
      run: () => detectEmptySlotTomorrow(prisma, clinicId, now, config),
      severityFor: (p) =>
        severityForEmptySlot(p as Extract<ActionPayload, { type: "EMPTY_SLOT_TOMORROW" }>),
    },
    {
      type: "DORMANT_BATCH",
      run: () => detectDormantBatch(prisma, clinicId, now, config),
      // Carry the bucket through the deeplink so the wizard opens pre-scoped.
      deeplinkPathFor: (p) =>
        `/crm/notifications/campaigns/new?segment=${
          (p as Extract<ActionPayload, { type: "DORMANT_BATCH" }>).segment
        }`,
    },
    {
      type: "UNCONFIRMED_24H",
      run: () => detectUnconfirmed24h(prisma, clinicId, now, config),
      severityFor: (p, n) =>
        severityForUnconfirmed24h(
          p as Extract<ActionPayload, { type: "UNCONFIRMED_24H" }>,
          n,
        ),
    },
    {
      type: "NO_SHOW_RISK_HIGH",
      run: () => detectNoShowRiskHigh(prisma, clinicId, now, config),
      severityFor: (p) =>
        severityForNoShowRisk(
          p as Extract<ActionPayload, { type: "NO_SHOW_RISK_HIGH" }>,
        ),
      // Action self-expires once the appointment time arrives.
      expiresAtFor: (p) => {
        const at = (p as Extract<ActionPayload, { type: "NO_SHOW_RISK_HIGH" }>)
          .appointmentAt;
        return new Date(at);
      },
    },
    {
      type: "CASE_REPEAT_DUE",
      run: () => detectCaseRepeatDue(prisma, clinicId, now, config),
    },
    {
      type: "OVERDUE_FOLLOW_UP",
      run: () => detectOverdueFollowUp(prisma, clinicId, now, config),
    },
    {
      type: "DOCTOR_OVERLOAD",
      run: () => detectDoctorOverload(prisma, clinicId, now, config),
      expiresAtFor: expiresInThirtyMin,
    },
    {
      type: "IDLE_ROOM",
      run: () => detectIdleRoom(prisma, clinicId, now, config),
      expiresAtFor: expiresInThirtyMin,
    },
    {
      type: "PAYMENT_OVERDUE",
      run: () => detectPaymentOverdue(prisma, clinicId, now, config),
      severityFor: (p) =>
        severityForPaymentOverdue(
          p as Extract<ActionPayload, { type: "PAYMENT_OVERDUE" }>,
        ),
    },
    {
      type: "LOW_DOCTOR_SCHEDULE",
      run: () => detectLowDoctorSchedule(prisma, clinicId, now, config),
    },
  ];

  // Run all 10 in parallel; isolate failures via Promise.allSettled.
  const runs = await Promise.allSettled(
    specs.map(async (s) => {
      const payloads = await s.run();
      return { spec: s, payloads };
    }),
  );

  // Persist outcomes sequentially so we have a deterministic emission order
  // for tests + audit trail. The detector calls themselves were parallel.
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const spec = specs[i]!;
    if (r.status === "rejected") {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      result.errors.push({ type: spec.type, error: message });
      continue;
    }
    const { payloads } = r.value;
    for (const payload of payloads) {
      try {
        const severity = spec.severityFor
          ? spec.severityFor(payload, now)
          : defaultSeverity(payload.type);
        const expiresAt =
          spec.expiresAtFor === undefined ? undefined : spec.expiresAtFor(payload, now);
        const deeplinkPath = spec.deeplinkPathFor
          ? spec.deeplinkPathFor(payload)
          : undefined;
        const upsertResult = await upsertAction(prisma, clinicId, payload, {
          severity,
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ?? null } : {}),
          ...(deeplinkPath !== undefined ? { deeplinkPath } : {}),
        });
        if (upsertResult.created) {
          result.created += 1;
          await safePublish(clinicId, "action.created", {
            id: upsertResult.id,
            type: payload.type,
            severity: upsertResult.severity,
          });
        } else if (upsertResult.payloadChanged || upsertResult.severityChanged) {
          result.updated += 1;
          await safePublish(clinicId, "action.updated", {
            id: upsertResult.id,
            type: payload.type,
            severity: upsertResult.severity,
          });
        } else {
          result.skipped += 1;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push({ type: spec.type, error: message });
      }
    }
  }

  // Sweep stale OPEN/SNOOZED actions (TTL 48h or explicit expiresAt elapsed).
  try {
    result.expired = await expireStaleActions(prisma, clinicId, 48);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.errors.push({ type: "EMPTY_SLOT_TOMORROW", error: `expireStale: ${message}` });
  }

  return result;
}

async function safePublish(
  clinicId: string,
  type: "action.created" | "action.updated",
  payload: { id: string; type: ActionType; severity: ActionSeverity },
): Promise<void> {
  try {
    await publishEvent(clinicId, { type, payload });
  } catch (e) {
    // Realtime fan-out is best-effort; never fail the engine because of it.
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[action-engine.publish] ${type} skipped: ${message}`);
  }
}
