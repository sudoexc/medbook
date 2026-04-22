import { z } from "zod";

export const ConversationChannelEnum = z.enum([
  "SMS",
  "TG",
  "CALL",
  "EMAIL",
  "VISIT",
]);
export const ConversationStatusEnum = z.enum(["OPEN", "SNOOZED", "CLOSED"]);
export const ConversationModeEnum = z.enum(["bot", "takeover"]);

export const UpdateConversationSchema = z.object({
  status: ConversationStatusEnum.optional(),
  mode: ConversationModeEnum.optional(),
  assignedToId: z.string().nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  snoozedUntil: z.coerce.date().nullable().optional(),
});

export const QueryConversationSchema = z.object({
  channel: ConversationChannelEnum.optional(),
  status: ConversationStatusEnum.optional(),
  assignedToId: z.string().optional(),
  unread: z.coerce.boolean().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type UpdateConversation = z.infer<typeof UpdateConversationSchema>;
