/**
 * Zod schemas for the Action Center REST surface (Phase 13 Wave 1).
 *
 * Mirrors the type-level union in `src/lib/actions/types.ts` for the wire
 * format. The DB-level shape is owned by `prisma/schema.prisma`.
 */
import { z } from "zod";

import {
  ACTION_SEVERITIES,
  ACTION_STATUSES,
  ACTION_TYPES,
} from "@/lib/actions/types";

export const ActionTypeEnum = z.enum([...ACTION_TYPES] as [string, ...string[]]);
export const ActionSeverityEnum = z.enum([
  ...ACTION_SEVERITIES,
] as [string, ...string[]]);
export const ActionStatusEnum = z.enum([
  ...ACTION_STATUSES,
] as [string, ...string[]]);

export const ActionAssigneeRoleEnum = z.enum(["ADMIN", "RECEPTIONIST"]);

/**
 * GET /api/crm/actions — list filters.
 *
 * - Repeated keys collapse into arrays via `parseQuery` (e.g. `?status=OPEN&status=SNOOZED`).
 * - Default `status` is OPEN-only when omitted (handler enforces this; the
 *   schema accepts an optional list).
 * - `cursor` is the createdAt ISO timestamp of the last seen row from the
 *   previous page; results are sorted by severity DESC, createdAt DESC.
 */
export const QueryActionSchema = z.object({
  status: z
    .union([ActionStatusEnum, z.array(ActionStatusEnum)])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    ),
  type: z
    .union([ActionTypeEnum, z.array(ActionTypeEnum)])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    ),
  severity: z
    .union([ActionSeverityEnum, z.array(ActionSeverityEnum)])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    ),
  assigneeRole: ActionAssigneeRoleEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * POST /api/crm/actions/[id]/snooze body. Either `until` (explicit ISO) OR
 * `preset` (server resolves to a wall-clock). Exactly one is required.
 */
export const SnoozeActionSchema = z
  .object({
    until: z.string().datetime().optional(),
    preset: z.enum(["1h", "4h", "tomorrow", "next-week"]).optional(),
  })
  .refine((v) => Boolean(v.until) !== Boolean(v.preset), {
    message: "Provide exactly one of {until, preset}",
  });

export const DismissActionSchema = z.object({
  reason: z.string().max(500).optional(),
});

/** No body required for done / reopen, but we keep schemas for symmetry. */
export const DoneActionSchema = z.object({}).passthrough();
export const ReopenActionSchema = z.object({}).passthrough();

/** The six call outcomes the risk-today widget records (TZ-risk-outcomes §1). */
export const ACTION_OUTCOMES = [
  "CONFIRMED",
  "RESCHEDULED",
  "CALLBACK",
  "RETURN_LATER",
  "REFUSED",
  "NO_ANSWER",
] as const;
export const ActionOutcomeEnum = z.enum(ACTION_OUTCOMES);

/**
 * POST /api/crm/actions/[id]/outcome body. `callbackAt` (ISO) is required for
 * CALLBACK (when to resurface) and RETURN_LATER (the return date); ignored for
 * the rest. `note` is what the patient said (reason / return context).
 */
export const OutcomeActionSchema = z
  .object({
    outcome: ActionOutcomeEnum,
    note: z.string().max(1000).optional(),
    callbackAt: z.string().datetime().optional(),
  })
  .refine(
    (v) =>
      (v.outcome !== "CALLBACK" && v.outcome !== "RETURN_LATER") ||
      Boolean(v.callbackAt),
    { message: "callbackAt is required for CALLBACK / RETURN_LATER" },
  );

export type QueryAction = z.infer<typeof QueryActionSchema>;
export type SnoozeActionBody = z.infer<typeof SnoozeActionSchema>;
export type DismissActionBody = z.infer<typeof DismissActionSchema>;
export type OutcomeActionBody = z.infer<typeof OutcomeActionSchema>;
