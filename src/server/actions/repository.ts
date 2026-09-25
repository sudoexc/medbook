/**
 * Action Center engine repository (Phase 13 Wave 1).
 *
 * Pure data-access helpers consumed by Wave 2 detectors and the cron-style
 * `actions-recompute` worker. **Both helpers MUST run inside an existing
 * tenant context** — i.e. the caller is responsible for wrapping calls in
 * `runWithTenant({ kind: "TENANT", clinicId, ... }, () => ...)` (or a SYSTEM
 * context that explicitly passes `clinicId`). Without a context the
 * tenant-scope Prisma extension would no-op and rows could leak across
 * clinics.
 *
 * The functions intentionally do not import `runWithTenant` themselves so
 * the engine can compose them inside a single context boundary.
 */

import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  defaultAssigneeRole,
  defaultDeeplinkPath,
  defaultSeverity,
  dedupeKeyFor,
  type ActionPayload,
  type ActionSeverity,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

/**
 * Tenant-scoped client alias. Narrowed from the original union with
 * `PrismaClient` because TS couldn't unify the overload signatures from
 * the extended-vs-raw clients, surfacing as TS2349 across every call site.
 * Test mocks bypass this with `as never`, so the union bought nothing.
 */
type PrismaLike = TenantScopedPrisma;

export type UpsertActionOptions = {
  /** Override default severity for this action type. */
  severity?: ActionSeverity;
  /** Optional explicit branch scope. Null = clinic-wide. */
  branchId?: string | null;
  /** Override the default deeplink path. */
  deeplinkPath?: string;
  /** Override the default assignee role. Pass `null` for "any role". */
  assigneeRole?: "ADMIN" | "RECEPTIONIST" | null;
  /**
   * Optional row-level expiry; the cron sweeper will mark these EXPIRED.
   * A row that carries one is exempt from the 48h `updatedAt` sweep (see
   * `expireStaleActions`), so event-driven rows nobody re-upserts must set it.
   */
  expiresAt?: Date | null;
  /**
   * Keep the row hidden until this instant: a task created ahead of its time
   * (the control-visit call a week before the due date). Stored as a snooze,
   * so every list surfaces it exactly like an elapsed «Отложить». When passed
   * on an update it re-schedules the row, because the caller recomputed it
   * from newer input (the doctor edited the follow-up interval).
   */
  surfaceAt?: Date | null;
};

export type UpsertResult = {
  /** Persistent action id. */
  id: string;
  /** True if this call inserted a new row, false if it updated an existing one. */
  created: boolean;
  /** New severity (post-write). */
  severity: ActionSeverity;
  /** True if any payload-significant field changed (only when created=false). */
  payloadChanged: boolean;
  /** True if severity changed (only when created=false). */
  severityChanged: boolean;
};

/** Fields whose change the audit pipeline considers "payload-significant". */
const PAYLOAD_SIGNIFICANT_KEYS: readonly string[] = [
  "type",
  "payload",
  "deeplinkPath",
  "assigneeRole",
  "expiresAt",
];

/**
 * Upsert an action keyed by `(clinicId, dedupeKey)`.
 *
 * Behaviour:
 *   - If no row exists, INSERT with status=OPEN (SNOOZED until
 *     `options.surfaceAt` when that is in the future) and emit ACTION_CREATED.
 *   - If a row exists, UPDATE the payload + severity + meta fields and bump
 *     `updatedAt`. Emit ACTION_UPDATED **only** when severity OR
 *     payload-significant fields change.
 *   - If the existing row is in a terminal state (DONE/DISMISSED/EXPIRED),
 *     the upsert resurrects it back to OPEN and clears the terminal stamps
 *     so the user sees the signal again. Emits ACTION_UPDATED in that case.
 *
 * Caller MUST be inside `runWithTenant(...)`. The tenant Prisma extension
 * scopes the unique lookup to the active clinic.
 */
export async function upsertAction(
  prisma: PrismaLike,
  clinicId: string,
  payload: ActionPayload,
  options: UpsertActionOptions = {},
): Promise<UpsertResult> {
  const dedupeKey = dedupeKeyFor(payload);
  const severity = options.severity ?? defaultSeverity(payload.type);
  const deeplinkPath = options.deeplinkPath ?? defaultDeeplinkPath(payload.type);
  const assigneeRole =
    options.assigneeRole === undefined
      ? defaultAssigneeRole(payload.type)
      : options.assigneeRole;
  const branchId = options.branchId ?? null;
  const expiresAt = options.expiresAt ?? null;
  const nowMs = Date.now();
  // Only a future surface time hides the row; a past one means "show now".
  const scheduledUntil =
    options.surfaceAt && options.surfaceAt.getTime() > nowMs
      ? options.surfaceAt
      : null;

  const existing = await prisma.action.findUnique({
    where: { clinicId_dedupeKey: { clinicId, dedupeKey } },
  });

  // Insert path -------------------------------------------------------------
  if (!existing) {
    const created = await prisma.action.create({
      data: {
        clinicId,
        branchId,
        type: payload.type,
        severity,
        payload: payload as never,
        status: scheduledUntil ? "SNOOZED" : "OPEN",
        snoozeUntil: scheduledUntil,
        assigneeRole,
        deeplinkPath,
        dedupeKey,
        expiresAt,
      } as never,
    });
    await emitEngineAudit(prisma, {
      clinicId,
      action: AUDIT_ACTION.ACTION_CREATED,
      entityId: created.id,
      meta: {
        type: payload.type,
        severity,
        payload,
        dedupeKey,
        assigneeRole,
        deeplinkPath,
        branchId,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
    return {
      id: created.id,
      created: true,
      severity,
      payloadChanged: false,
      severityChanged: false,
    };
  }

  // Update path -------------------------------------------------------------
  // Outcome lock (TZ-risk-outcomes §3): once a human recorded a call outcome,
  // the row must NOT be auto-resurrected by the 15-min recompute — that churn
  // ("marked handled → back in 15 min") is exactly what the widget redesign
  // kills. The outcome stays authoritative until the appointment itself passes
  // (`expiresAt`). SNOOZED already survives recompute below, so CALLBACK /
  // RETURN_LATER / NO_ANSWER (which snooze) are covered; this guards the
  // DONE outcomes (CONFIRMED / RESCHEDULED / REFUSED).
  const outcomeLocked =
    existing.status === "DONE" &&
    (existing as { outcome?: string | null }).outcome != null &&
    existing.expiresAt != null &&
    nowMs < existing.expiresAt.getTime();
  const wasTerminal =
    !outcomeLocked &&
    (existing.status === "DONE" ||
      existing.status === "DISMISSED" ||
      existing.status === "EXPIRED");
  let newStatus = wasTerminal ? "OPEN" : existing.status;
  // Snooze stays untouched by default: an explicit user-set timer survives
  // recompute, so the column is not even written. A caller-supplied surface
  // time re-schedules the row (unless a recorded outcome locks it).
  const reschedule = options.surfaceAt !== undefined && !outcomeLocked;
  if (reschedule) {
    if (scheduledUntil) newStatus = "SNOOZED";
    else if (newStatus === "SNOOZED") newStatus = "OPEN";
  }

  const oldPayload = existing.payload as ActionPayload | null;
  const payloadChanged =
    !oldPayload ||
    JSON.stringify(oldPayload) !== JSON.stringify(payload) ||
    existing.deeplinkPath !== deeplinkPath ||
    existing.assigneeRole !== assigneeRole ||
    (existing.expiresAt?.toISOString() ?? null) !==
      (expiresAt?.toISOString() ?? null) ||
    existing.type !== payload.type;
  const severityChanged = existing.severity !== severity;

  await prisma.action.update({
    where: { id: existing.id },
    data: {
      branchId,
      type: payload.type,
      severity,
      payload: payload as never,
      status: newStatus,
      assigneeRole,
      deeplinkPath,
      expiresAt,
      // Clear terminal stamps when resurrecting.
      doneAt: wasTerminal ? null : existing.doneAt,
      dismissedAt: wasTerminal ? null : existing.dismissedAt,
      ...(reschedule ? { snoozeUntil: scheduledUntil } : {}),
    } as never,
  });

  // Emit ACTION_UPDATED only when something interesting changed (or we
  // resurrected from a terminal state). No-op upserts stay silent so the
  // 15-minute recompute job doesn't spam audit rows.
  if (payloadChanged || severityChanged || wasTerminal) {
    await emitEngineAudit(prisma, {
      clinicId,
      action: AUDIT_ACTION.ACTION_UPDATED,
      entityId: existing.id,
      meta: {
        type: payload.type,
        severity,
        oldSeverity: existing.severity,
        oldStatus: existing.status,
        newStatus,
        payload,
        oldPayload,
        dedupeKey,
        payloadChanged,
        severityChanged,
        resurrectedFromTerminal: wasTerminal,
      },
    });
  }

  return {
    id: existing.id,
    created: false,
    severity,
    payloadChanged,
    severityChanged,
  };
}

/**
 * Mark stale OPEN/SNOOZED actions as EXPIRED. Two triggers:
 *   1. `expiresAt` is set and in the past, OR
 *   2. the row has NO `expiresAt` and was last touched more than `ttlHours`
 *      (default 48h) ago — protects against detectors that stop firing
 *      without explicitly clearing.
 *
 * The 48h sweep is a fallback for detector rows, which the engine re-upserts
 * every 15 minutes while their signal holds. It must not reach two kinds of
 * rows (audit AC-01 / AC-03):
 *   - rows with an explicit deadline. Event-driven tasks (control visit, low
 *     NPS) are written once and never refreshed, so their `updatedAt` goes
 *     stale after two days while the task is still weeks from due;
 *   - rows a user snoozed. «Отложить на неделю» must not quietly expire on
 *     day two, so the TTL counts from the later of the last refresh and the
 *     snooze timer.
 *
 * Returns the number of rows expired. Emits one ACTION_EXPIRED audit per
 * row. Caller MUST be inside `runWithTenant(...)`.
 */
export async function expireStaleActions(
  prisma: PrismaLike,
  clinicId: string,
  ttlHours = 48,
): Promise<number> {
  const now = new Date();
  const ttlCutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);

  // Tenant extension already scopes by clinicId on `findMany`. We pass
  // `clinicId` explicitly here for clarity and so callers running inside a
  // SYSTEM context still get correct behaviour.
  const stale = await prisma.action.findMany({
    where: {
      clinicId,
      status: { in: ["OPEN", "SNOOZED"] },
      OR: [
        { expiresAt: { lte: now } },
        {
          expiresAt: null,
          updatedAt: { lte: ttlCutoff },
          OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: ttlCutoff } }],
        },
      ],
    },
    select: { id: true, type: true, severity: true, status: true },
  });

  if (stale.length === 0) return 0;

  await prisma.action.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: { status: "EXPIRED" },
  });

  // Audit emit per row — kept sequential (not parallel) so the rows land in
  // a deterministic order for replay / debugging.
  for (const row of stale) {
    await emitEngineAudit(prisma, {
      clinicId,
      action: AUDIT_ACTION.ACTION_EXPIRED,
      entityId: row.id,
      meta: {
        type: row.type,
        severity: row.severity,
        oldStatus: row.status,
        newStatus: "EXPIRED",
        ttlHours,
      },
    });
  }

  return stale.length;
}

// ──────────────────────────────────────────────────────────────────────────
// Internal: engine-side audit emit. The standard `audit()` helper in
// `src/lib/audit.ts` reads the active session for actor metadata; the
// engine has no session, so we write directly with an "engine" actor label.
// ──────────────────────────────────────────────────────────────────────────

type EngineAuditInput = {
  clinicId: string;
  action: string;
  entityId: string;
  meta: unknown;
};

async function emitEngineAudit(
  prisma: PrismaLike,
  input: EngineAuditInput,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorId: null,
        actorRole: "SYSTEM",
        actorLabel: "action-engine",
        action: input.action,
        entityType: "Action",
        entityId: input.entityId,
        meta: (input.meta ?? null) as never,
        ip: null,
        userAgent: null,
      },
    });
  } catch (err) {
    // Mirror the soft-failure behaviour of `src/lib/audit.ts` — never let a
    // dead audit table take down the engine.
    console.error("[action-engine.audit]", err);
  }
}

// Re-export utility list for tests that want to assert the surface.
export const PAYLOAD_KEYS = PAYLOAD_SIGNIFICANT_KEYS;
