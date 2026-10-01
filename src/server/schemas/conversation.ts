import { z } from "zod";

import { queryBool } from "./query-bool";

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
  patientId: z.string().nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  snoozedUntil: z.coerce.date().nullable().optional(),
  markRead: z.boolean().optional(),
  /**
   * «Ответ не нужен» (audit G6-03): the patient's last message needs no
   * answer («Спасибо!»), so the thread leaves «Неотвеченные» without a reply.
   */
  markAnswered: z.literal(true).optional(),
  /**
   * Staff confirmed the chat's Telegram account is the linked card's own
   * (audit TG-11 review): bind it even though the card holds history or
   * the profile goes by another name.
   */
  linkTelegram: z.literal(true).optional(),
});

export const QueryConversationSchema = z.object({
  channel: ConversationChannelEnum.optional(),
  status: ConversationStatusEnum.optional(),
  mode: ConversationModeEnum.optional(),
  assignedToId: z.string().optional(),
  /**
   * Scope to a specific doctor. Pass `me` to use the caller's doctor id
   * (resolved from the session). Returns conversations either explicitly
   * assigned to that doctor's user, or tied to one of their appointments.
   */
  doctorId: z.string().optional(),
  /**
   * Scope to a specific patient. Used by the appointments-table "Telegram"
   * row action and the patient page "Открыть в Telegram" quick action so the
   * inbox lands prefiltered to the patient's threads.
   */
  patientId: z.string().optional(),
  unread: queryBool(),
  /**
   * «Неотвеченные» (audit G6-03): a patient message no staff reply followed
   * (`awaitingReplySince`), unlike `unread`, which opening the chat clears.
   */
  unanswered: queryBool(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type UpdateConversation = z.infer<typeof UpdateConversationSchema>;
