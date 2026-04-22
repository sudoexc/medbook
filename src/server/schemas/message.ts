import { z } from "zod";

export const MessageDirectionEnum = z.enum(["IN", "OUT"]);
export const MessageStatusEnum = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);

export const SendMessageSchema = z.object({
  body: z.string().min(1).max(10000),
  attachments: z.array(z.unknown()).optional(),
  buttons: z.unknown().optional(),
  replyToId: z.string().optional().nullable(),
});

export const QueryMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  direction: MessageDirectionEnum.optional(),
});

export type SendMessage = z.infer<typeof SendMessageSchema>;
