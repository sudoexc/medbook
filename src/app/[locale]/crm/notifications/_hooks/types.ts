export type TemplateChannel = "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
export type TemplateCategory = "REMINDER" | "MARKETING" | "TRANSACTIONAL";

export type QueueStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "CANCELLED";

export type QueueTab = "all" | "pending" | "sent" | "failed";

export const STATUS_FOR_TAB: Record<QueueTab, QueueStatus | null> = {
  all: null,
  pending: "QUEUED",
  sent: "SENT",
  failed: "FAILED",
};
