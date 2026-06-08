import { z } from "zod";

/**
 * Communication channel enum.
 *
 * "SMS" is retained as a read-only literal so legacy Communication rows
 * (manually logged before `docs/TZ-sms-removal.md`) remain queryable. The
 * Wave 5 schema migration drops it from the underlying Prisma enum and
 * this list will follow.
 */
export const CommunicationChannelEnum = z.enum([
  "SMS",
  "TG",
  "CALL",
  "EMAIL",
  "VISIT",
]);
export const CommunicationDirectionEnum = z.enum(["IN", "OUT"]);

export const CreateCommunicationSchema = z.object({
  patientId: z.string().optional().nullable(),
  channel: CommunicationChannelEnum,
  direction: CommunicationDirectionEnum,
  subject: z.string().max(500).optional().nullable(),
  body: z.string().max(10000).optional().nullable(),
  meta: z.unknown().optional(),
});

// `SendSmsSchema` was deleted in Wave 3 of `docs/TZ-sms-removal.md`.
// No route consumes it; the corresponding test gate is removed in Wave 3d.

export const QueryCommunicationSchema = z.object({
  patientId: z.string().optional(),
  channel: CommunicationChannelEnum.optional(),
  direction: CommunicationDirectionEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCommunication = z.infer<typeof CreateCommunicationSchema>;
