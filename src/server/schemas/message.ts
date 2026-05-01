import { z } from "zod";

export const MessageDirectionEnum = z.enum(["IN", "OUT"]);
export const MessageStatusEnum = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);

export const MessageAttachmentSchema = z.object({
  kind: z.literal("image"),
  url: z.string().min(1).max(2000),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative().optional(),
  name: z.string().max(256).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const SendMessageSchema = z
  .object({
    body: z.string().max(10000).default(""),
    attachments: z.array(MessageAttachmentSchema).max(10).optional(),
    buttons: z.unknown().optional(),
    replyToId: z.string().optional().nullable(),
  })
  .refine(
    (v) =>
      (v.body && v.body.trim().length > 0) ||
      (Array.isArray(v.attachments) && v.attachments.length > 0),
    { message: "Either body or attachments is required", path: ["body"] },
  );

export const QueryMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  direction: MessageDirectionEnum.optional(),
});

export type SendMessage = z.infer<typeof SendMessageSchema>;
