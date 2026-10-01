import { z } from "zod";

export const CallDirectionEnum = z.enum(["IN", "OUT", "MISSED"]);

export const CreateCallSchema = z.object({
  direction: CallDirectionEnum,
  fromNumber: z.string().min(3).max(40),
  toNumber: z.string().min(3).max(40),
  patientId: z.string().optional().nullable(),
  operatorId: z.string().optional().nullable(),
  appointmentId: z.string().optional().nullable(),
  durationSec: z.number().int().min(0).optional().nullable(),
  recordingUrl: z.string().url().optional().nullable(),
  summary: z.string().max(10000).optional().nullable(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  sipCallId: z.string().max(200).optional().nullable(),
  endedAt: z.coerce.date().optional().nullable(),
});

/**
 * PATCH /api/crm/calls/[id]: the notes, tags and links of a call. Ending a
 * call is not an edit (audit CM-07): `endedAt` here closed the row without
 * its status, direction or duration, so «Завершить» left it «Звонит» and
 * «Пропуск» was never counted. That is `POST /api/crm/calls/[id]/end`.
 */
export const UpdateCallSchema = z.object({
  operatorId: z.string().nullable().optional(),
  patientId: z.string().nullable().optional(),
  appointmentId: z.string().nullable().optional(),
  summary: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
});

/** POST /api/crm/calls/[id]/end: «Завершить» (ENDED) or «Пропуск» (MISSED). */
export const EndCallSchema = z.object({
  outcome: z.enum(["ENDED", "MISSED"]),
});

export const QueryCallSchema = z.object({
  direction: CallDirectionEnum.optional(),
  operatorId: z.string().optional(),
  patientId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().optional(),
  /** `true`: calls still in progress only (no `endedAt`), the live queue. */
  open: z.enum(["true", "false"]).optional(),
  /**
   * Missed calls by call-back state (audit CM-13): `pending` hides the ones
   * an operator marked «Перезвонили», `done` shows only those.
   */
  callback: z.enum(["pending", "done"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCall = z.infer<typeof CreateCallSchema>;
export type UpdateCall = z.infer<typeof UpdateCallSchema>;
export type EndCall = z.infer<typeof EndCallSchema>;
