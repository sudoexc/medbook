import { z } from "zod";

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

export const SendSmsSchema = z.object({
  patientId: z.string().optional().nullable(),
  phone: z.string().min(3).max(40),
  body: z.string().min(1).max(1600),
});

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
export type SendSms = z.infer<typeof SendSmsSchema>;
