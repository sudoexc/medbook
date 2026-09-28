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
  DETECTOR_ACTION_TYPES,
  RISK_ACTION_TYPES,
  actionSubjectOf,
  defaultAssigneeRole,
  defaultDeeplinkPath,
  defaultSeverity,
  dedupeKeyFor,
  type ActionPayload,
  type ActionSeverity,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

import {
  ABANDONED_RESCHEDULE_GRACE_MIN,
  CLOSED_SIGNAL_LAPSE_HOURS,
} from "./config";

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
   * Detector rows without one fall back to the 48h `updatedAt` sweep; an
   * event-driven row without one stays until a person closes it (see
   * `expireStaleActions`).
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
  /**
   * True when the row is closed by a person (DONE / DISMISSED) and this
   * upsert left it closed (see `closedRowReopens`). The row is refreshed but
   * invisible, so callers must not announce it.
   */
  keptClosed: boolean;
};

/** Statuses a person sets: «Готово», «Отклонить», or a recorded outcome. */
const CLOSED_BY_PERSON: ReadonlySet<string> = new Set(["DONE", "DISMISSED"]);

const DETECTOR_TYPES: ReadonlySet<string> = new Set(DETECTOR_ACTION_TYPES);

/** The visit-bound types a call outcome is recorded on. */
const RISK_TYPES: ReadonlySet<string> = new Set(RISK_ACTION_TYPES);

/**
 * The call-outcome columns (TZ-risk-outcomes). A reopen clears them: they
 * describe how the previous occurrence was handled, not the new one.
 */
const CLEARED_OUTCOME = {
  outcome: null,
  outcomeNote: null,
  callbackAt: null,
  resolvedById: null,
} as const;

/**
 * Whether a closed row carries a «Перенести» that was never carried out
 * (review of audit AC-08; the root fix is AC-10).
 *
 * The risk-today «Перенести» records outcome RESCHEDULED, closing the visit's
 * risk rows, and only then opens the appointment drawer where the date is
 * moved. Reception interrupted there closes the drawer: the visit stays at
 * 15:00, still unconfirmed, while its rows say it was moved. The old
 * unconditional reopen brought such a row back on the next pass. The AC-08
 * rule cannot (the subject did not change and the detector never lapsed),
 * and neither can the outcome lock on NO_SHOW_RISK_HIGH, so the visit was
 * gone from the risk list, «К подтверждению», the KPIs and the briefing
 * until its time, with «Перенести» in «Обработано сегодня».
 *
 * So a RESCHEDULED on a visit-bound row whose visit is still at the same
 * time `ABANDONED_RESCHEDULE_GRACE_MIN` after the outcome did not happen, and
 * the row reopens (lock or not: the outcome is not true). A saved move
 * changes the subject and goes through the ordinary rule. A person's
 * «Готово» on a reopened row does not trip this, because the reopen cleared
 * the outcome (`CLEARED_OUTCOME`).
 */
export function rescheduleNeverHappened(
  existing: {
    type: string;
    status: string;
    payload: unknown;
    outcome?: string | null;
    doneAt?: Date | null;
  },
  next: ActionPayload,
  now: Date,
): boolean {
  if (existing.status !== "DONE" || existing.outcome !== "RESCHEDULED") return false;
  if (!RISK_TYPES.has(next.type) || !existing.doneAt) return false;
  const sinceMs = now.getTime() - existing.doneAt.getTime();
  if (sinceMs <= ABANDONED_RESCHEDULE_GRACE_MIN * 60 * 1000) return false;
  const before = existing.payload as ActionPayload | null;
  return (
    !!before &&
    typeof before === "object" &&
    before.type === next.type &&
    actionSubjectOf(before) === actionSubjectOf(next)
  );
}

/**
 * Whether an upsert should reopen a row a person closed (audit AC-08).
 *
 * The rule: a closed task comes back only when something genuinely new
 * happened.
 *   1. Its subject changed (`actionSubjectOf`): the visit moved to another
 *      time, the control date or the debt changed, a new rating, a callback
 *      set for another time. Readings that drift on their own (risk %, days
 *      overdue, a segment's size, a doctor's slot count) do not count, which
 *      is what kept «Отклонить» on a debt paid in cash from lasting a day.
 *   2. For detector types only: the signal lapsed and came back. The engine
 *      re-upserts a live signal every 15 minutes and each pass touches the
 *      closed row, so a gap over `CLOSED_SIGNAL_LAPSE_HOURS` since the last
 *      touch means the detector had stopped firing: this is a new occurrence
 *      (the same doctor overloaded again tomorrow). Event-driven rows are
 *      written once per event, so their gaps say nothing: a doctor editing
 *      a finalized note re-bridges VISIT_FOLLOW_UP_DUE days later, and that
 *      must not reopen the control-visit call reception already made.
 *
 * Neither a repeated call (a second missed reminder in the same day bucket,
 * «Пересчитать сейчас», the next engine pass) nor time alone reopens a
 * closed row. An admin can always reopen it by hand («Вернуть в работу»).
 * EXPIRED is not a person's decision: the system closed it because the
 * signal went stale, so any upsert brings it back, as before.
 */
export function closedRowReopens(
  existing: { type: string; payload: unknown; updatedAt?: Date | null },
  next: ActionPayload,
  now: Date,
): boolean {
  const before = existing.payload as ActionPayload | null;
  const subjectBefore =
    before && typeof before === "object" && before.type === next.type
      ? actionSubjectOf(before)
      : null;
  if (subjectBefore !== actionSubjectOf(next)) return true;
  if (!DETECTOR_TYPES.has(next.type) || !existing.updatedAt) return false;
  const silentMs = now.getTime() - existing.updatedAt.getTime();
  return silentMs > CLOSED_SIGNAL_LAPSE_HOURS * 60 * 60 * 1000;
}

/**
 * The instant a row written now becomes visible in the work lists: the end of
 * its snooze when that is still ahead, otherwise now. Every writer that hides
 * or reopens a row stamps `surfacedAt` with it, and the lists order by
 * `surfacedAt`, so a task that comes back sits at the top of its severity
 * instead of at the position of its original insert.
 */
export function surfaceMoment(now: Date, snoozeUntil: Date | null | undefined): Date {
  return snoozeUntil && snoozeUntil.getTime() > now.getTime() ? snoozeUntil : now;
}

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
 *     `surfacedAt` is the moment the row becomes visible.
 *   - If a row exists, UPDATE the payload + severity + meta fields and bump
 *     `updatedAt`. Emit ACTION_UPDATED **only** when severity OR
 *     payload-significant fields change.
 *   - A row a person closed (DONE / DISMISSED) stays closed unless something
 *     genuinely new happened (`closedRowReopens`, audit AC-08): it is still
 *     refreshed, silently, so the lapse clock and an admin's «Вернуть» see
 *     current data. Before, every closed row was back in OPEN on the next
 *     15-minute pass and «Готово» / «Отклонить» did nothing.
 *   - A row closed by a «Перенести» whose visit never moved reopens once the
 *     grace has passed (`rescheduleNeverHappened`), outcome lock or not.
 *   - An EXPIRED row (closed by the system) is reopened to OPEN with its
 *     terminal stamps cleared, so the user sees the signal again. Emits
 *     ACTION_UPDATED, as does any reopen. Every reopen clears the call
 *     outcome columns with the other terminal stamps.
 *   - `surfacedAt` moves only when the row (re)appears: a reopen, or a
 *     re-schedule that hides it or brings a hidden row forward. A detector
 *     refresh of a visible row keeps its place in the list.
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
  const now = new Date();
  const nowMs = now.getTime();
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
        surfacedAt: surfaceMoment(now, scheduledUntil),
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
      keptClosed: false,
    };
  }

  // Update path -------------------------------------------------------------
  // Outcome lock (TZ-risk-outcomes §3): once a human recorded a call outcome,
  // the row must NOT be auto-resurrected by the 15-min recompute — that churn
  // ("marked handled → back in 15 min") is exactly what the widget redesign
  // kills. The outcome stays authoritative until the appointment itself passes
  // (`expiresAt`), even over a change of subject. SNOOZED already survives
  // recompute below, so a callback before the visit and NO_ANSWER (which
  // snooze) are covered; this guards the DONE outcomes (CONFIRMED /
  // RESCHEDULED / REFUSED, and a call handed to a PATIENT_CALLBACK task).
  // A «Перенести» whose visit never moved is the exception: it is not a
  // handled outcome, so it neither locks nor keeps the row closed.
  const rescheduleVoid = rescheduleNeverHappened(
    existing as Parameters<typeof rescheduleNeverHappened>[0],
    payload,
    now,
  );
  const outcomeLocked =
    !rescheduleVoid &&
    existing.status === "DONE" &&
    (existing as { outcome?: string | null }).outcome != null &&
    existing.expiresAt != null &&
    nowMs < existing.expiresAt.getTime();
  const closedByPerson = CLOSED_BY_PERSON.has(existing.status);
  const reopened = closedByPerson
    ? rescheduleVoid ||
      (!outcomeLocked &&
        closedRowReopens(
          existing as { type: string; payload: unknown; updatedAt?: Date | null },
          payload,
          now,
        ))
    : existing.status === "EXPIRED";
  const keptClosed = closedByPerson && !reopened;
  let newStatus = reopened ? "OPEN" : existing.status;
  // Snooze stays untouched by default: an explicit user-set timer survives
  // recompute, so the column is not even written. A caller-supplied surface
  // time re-schedules the row, unless it stays closed: re-bridging a control
  // visit after a note edit must not push a finished call back into SNOOZED.
  const reschedule = options.surfaceAt !== undefined && !keptClosed;
  if (reschedule) {
    if (scheduledUntil) newStatus = "SNOOZED";
    else if (newStatus === "SNOOZED") newStatus = "OPEN";
  }
  // The row reappears (or is scheduled to) when it is resurrected, pushed to
  // a future surface time, or brought forward from a live snooze. Otherwise
  // it keeps its `surfacedAt`: the 15-minute refresh of a visible detector
  // row must not reshuffle the list.
  const snoozeAfter = reschedule ? scheduledUntil : existing.snoozeUntil;
  const wasHidden =
    existing.status === "SNOOZED" &&
    existing.snoozeUntil != null &&
    existing.snoozeUntil.getTime() > nowMs;
  const resurfaces =
    reopened || (reschedule && (scheduledUntil != null || wasHidden));

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
      // Clear terminal stamps when reopening, the call outcome included.
      doneAt: reopened ? null : existing.doneAt,
      dismissedAt: reopened ? null : existing.dismissedAt,
      ...(reopened ? CLEARED_OUTCOME : {}),
      ...(reschedule ? { snoozeUntil: scheduledUntil } : {}),
      ...(resurfaces ? { surfacedAt: surfaceMoment(now, snoozeAfter) } : {}),
    } as never,
  });

  // Emit ACTION_UPDATED only when something interesting changed on a row
  // somebody can see (or we reopened it). No-op upserts and refreshes of a
  // row kept closed stay silent so the 15-minute recompute job doesn't spam
  // audit rows.
  if (reopened || (!keptClosed && (payloadChanged || severityChanged))) {
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
        resurrectedFromTerminal: reopened,
        ...(rescheduleVoid ? { abandonedReschedule: true } : {}),
      },
    });
  }

  return {
    id: existing.id,
    created: false,
    severity,
    payloadChanged,
    severityChanged,
    keptClosed,
  };
}

/**
 * True when the row holds a call outcome that is still its own: the outcome
 * snoozed it («Не дозвонился», «Перезвонить позже»). Outcomes leave a row
 * DONE or SNOOZED, never OPEN, so an OPEN row's outcome is a leftover of an
 * earlier occurrence (rows reopened before `CLEARED_OUTCOME` kept theirs).
 */
function carriesLiveOutcome(row: { status: string; outcome?: string | null }): boolean {
  return row.status === "SNOOZED" && row.outcome != null;
}

/**
 * Close OPEN / SNOOZED rows because their signal is gone, with one audit per
 * row. Shared by the stale sweep's callers that know better than a timer why
 * a row is moot (a risk row of a visit the patient has come to, or that is
 * over, audit AC-07). A row nobody handled is EXPIRED and may come back if
 * the signal does. A row with a call outcome of its own is DONE, the outcome
 * kept and `doneAt` now: a person did work on it, and «Обработано сегодня»
 * lists it. Caller MUST be inside `runWithTenant(...)`.
 */
export async function retireActions(
  prisma: PrismaLike,
  clinicId: string,
  rows: ReadonlyArray<{
    id: string;
    type: string;
    severity: string;
    status: string;
    outcome?: string | null;
    /** Why this row is moot, when it differs from the batch's `reason`. */
    reason?: string;
  }>,
  reason: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const handled = rows.filter(carriesLiveOutcome);
  const unhandled = rows.filter((r) => !carriesLiveOutcome(r));
  const live = { in: ["OPEN", "SNOOZED"] };
  if (handled.length > 0) {
    await prisma.action.updateMany({
      where: { id: { in: handled.map((r) => r.id) }, status: live },
      data: { status: "DONE", doneAt: now },
    });
  }
  if (unhandled.length > 0) {
    await prisma.action.updateMany({
      where: { id: { in: unhandled.map((r) => r.id) }, status: live },
      data: { status: "EXPIRED" },
    });
  }
  for (const row of rows) {
    const done = carriesLiveOutcome(row);
    await emitEngineAudit(prisma, {
      clinicId,
      action: done ? AUDIT_ACTION.ACTION_DONE : AUDIT_ACTION.ACTION_EXPIRED,
      entityId: row.id,
      meta: {
        type: row.type,
        severity: row.severity,
        oldStatus: row.status,
        newStatus: done ? "DONE" : "EXPIRED",
        ...(done ? { outcome: row.outcome, doneAt: now.toISOString() } : {}),
        reason: row.reason ?? reason,
      },
    });
  }
  return rows.length;
}

/**
 * Mark stale OPEN/SNOOZED actions as EXPIRED. Two triggers:
 *   1. `expiresAt` is set and in the past, OR
 *   2. a DETECTOR row (`DETECTOR_ACTION_TYPES`) has NO `expiresAt` and was
 *      last touched more than `ttlHours` (default 48h) ago — protects
 *      against detectors that stop firing without explicitly clearing.
 *
 * The 48h sweep is a fallback for detector rows, which the engine re-upserts
 * every 15 minutes while their signal holds. It must not reach three kinds of
 * rows (audit AC-01 / AC-03):
 *   - rows with an explicit deadline: that deadline alone decides;
 *   - event-driven rows (control visit, low NPS, Telegram card conflict, …).
 *     They are written once and never refreshed, so their `updatedAt` goes
 *     stale after two days while the task is still live. The sweep is scoped
 *     to the engine's own types rather than exempting known event types, so
 *     a new write-once emitter cannot be erased by forgetting `expiresAt`;
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
          type: { in: [...DETECTOR_ACTION_TYPES] },
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
