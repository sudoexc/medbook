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
  kind: z.enum(["image", "file"]),
  url: z.string().min(1).max(2000),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative().optional(),
  name: z.string().max(256).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

/**
 * One inline-keyboard button as Telegram takes it (audit TG-26): its text
 * and exactly one of callback_data (1 to 64 bytes) or url. A button without
 * either made Telegram refuse the whole message, which then ended FAILED.
 */
export const InlineButtonSchema = z
  .object({
    text: z.string().trim().min(1).max(64),
    callback_data: z
      .string()
      .min(1)
      .refine((v) => new TextEncoder().encode(v).length <= 64, {
        message: "callback_data is limited to 64 bytes",
      })
      .optional(),
    url: z.string().url().max(2000).optional(),
  })
  .refine((b) => (b.callback_data === undefined) !== (b.url === undefined), {
    message: "A button needs either callback_data or url",
  });

export const SendMessageSchema = z
  .object({
    body: z.string().max(10000).default(""),
    attachments: z.array(MessageAttachmentSchema).max(10).optional(),
    buttons: z
      .array(z.array(InlineButtonSchema).min(1).max(8))
      .min(1)
      .max(10)
      .optional(),
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
