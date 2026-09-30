/**
 * Client-side types for the Telegram inbox. Kept local so the bundle
 * doesn't pull Prisma types.
 */

export type ConversationMode = "bot" | "takeover";
export type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";

export type InboxPatientMini = {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  tgBlockedAt: string | null;
};

export type InboxAssignee = {
  id: string;
  name: string;
};

export type InboxConversation = {
  id: string;
  clinicId: string;
  channel: "TG" | "CALL" | "EMAIL" | "VISIT";
  mode: ConversationMode;
  status: ConversationStatus;
  externalId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactUsername: string | null;
  patientId: string | null;
  patient: InboxPatientMini | null;
  assignedToId: string | null;
  assignedTo: InboxAssignee | null;
  tags: string[];
  lastMessageAt: string | null;
  lastMessageText: string | null;
  unreadCount: number;
  /**
   * Oldest patient message no staff reply followed (audit G6-03): the thread
   * is in «Неотвеченные» while set. Reading it does not clear it.
   */
  awaitingReplySince?: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InboxMessage = {
  id: string;
  conversationId: string;
  direction: "IN" | "OUT";
  body: string | null;
  attachments: unknown;
  buttons: unknown;
  senderId: string | null;
  sender: { id: string; name: string } | null;
  /** QUEUED / SENDING: the send worker has not finished it yet (TG-17). */
  status: "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  /** Why a FAILED staff message did not reach Telegram (`tg_blocked`, …). */
  failedReason?: string | null;
  /**
   * An automatic message the bot sent (audit G6-08): a campaign or a
   * reminder copied into the dialog. Null for the chat itself.
   */
  origin?: "broadcast" | "notification" | null;
  externalId: string | null;
  replyToId: string | null;
  createdAt: string;
};

export type ConversationListResponse = {
  rows: InboxConversation[];
  nextCursor: string | null;
};

export type MessagesResponse = {
  rows: InboxMessage[];
  nextCursor: string | null;
};

export type ModeFilter = "all" | "bot" | "takeover";
