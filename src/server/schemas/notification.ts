import { z } from "zod";

/**
 * Notification channel enum.
 *
 * "SMS" was dropped here in Wave 3 of `docs/TZ-sms-removal.md`. The
 * NotificationTemplate/NotificationSend DB columns still carry the
 * literal until the Wave 5 migration so historical rows remain
 * intact — but no new SMS rows can be created through the API.
 * Stale clients that still POST `channel: "SMS"` get a Zod error.
 */
export const NotificationChannelEnum = z.enum([
  "TG",
  "CALL",
  "EMAIL",
  "VISIT",
]);
export const NotificationCategoryEnum = z.enum([
  "REMINDER",
  "MARKETING",
  "TRANSACTIONAL",
]);
// Every event the template editor can bind a template to (audit TG-25), the
// enum values `TEMPLATE_EVENTS` uses included.
export const NotificationTriggerEnum = z.enum([
  "MANUAL",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_BEFORE",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_RUNNING_LATE",
  "APPOINTMENT_MISSED",
  "APPOINTMENT_COMPLETED",
  "PATIENT_BIRTHDAY",
  "PATIENT_INACTIVE_DAYS",
  "CASE_REPEAT_DUE",
  "CRON",
]);
export const NotificationStatusEnum = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "CANCELLED",
]);

// --- Templates --------------------------------------------------------------

const TemplateFieldsSchema = z.object({
  key: z.string().min(2).max(100),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  channel: NotificationChannelEnum,
  category: NotificationCategoryEnum,
  bodyRu: z.string().min(1).max(10000),
  bodyUz: z.string().min(1).max(10000),
  buttons: z.unknown().optional().nullable(),
  variables: z.array(z.string().max(100)).max(100).optional(),
  trigger: NotificationTriggerEnum,
  triggerConfig: z.unknown().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const CreateTemplateSchema = TemplateFieldsSchema.extend({
  trigger: NotificationTriggerEnum.default("MANUAL"),
});

// No default here (audit TG-25): Zod 4 applies a `.default()` even inside
// `.partial()`, so every PATCH (an edited text, the «Триггеры» switch) came
// with `trigger: "MANUAL"` and silently unbound the template from its event.
export const UpdateTemplateSchema = TemplateFieldsSchema.partial();

export const QueryTemplateSchema = z.object({
  channel: NotificationChannelEnum.optional(),
  category: NotificationCategoryEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// --- Sends ------------------------------------------------------------------

export const CreateSendSchema = z.object({
  templateId: z.string().optional().nullable(),
  patientId: z.string(),
  appointmentId: z.string().optional().nullable(),
  channel: NotificationChannelEnum,
  recipient: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  scheduledFor: z.coerce.date(),
});

export const QuerySendSchema = z.object({
  status: NotificationStatusEnum.optional(),
  channel: NotificationChannelEnum.optional(),
  templateId: z.string().optional(),
  patientId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplate = z.infer<typeof UpdateTemplateSchema>;
export type CreateSend = z.infer<typeof CreateSendSchema>;
