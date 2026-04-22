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

export const UpdateCallSchema = z.object({
  operatorId: z.string().nullable().optional(),
  patientId: z.string().nullable().optional(),
  appointmentId: z.string().nullable().optional(),
  durationSec: z.number().int().min(0).nullable().optional(),
  summary: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  endedAt: z.coerce.date().nullable().optional(),
});

export const QueryCallSchema = z.object({
  direction: CallDirectionEnum.optional(),
  operatorId: z.string().optional(),
  patientId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCall = z.infer<typeof CreateCallSchema>;
export type UpdateCall = z.infer<typeof UpdateCallSchema>;
