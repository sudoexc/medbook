import { z } from "zod";

/**
 * Schemas for the CRM «Заявки» screen (`/api/crm/online-requests`).
 *
 * The screen reads and writes the `Lead` table: that is where the public
 * booking form lands (POST /api/leads). The older `OnlineRequest` model had
 * no writer at all, so a screen built on it would have stayed empty forever
 * (audit LD-01).
 */
/** Staff who work the requests: the desk, the call center and the admin. */
export const ONLINE_REQUEST_ROLES = [
  "ADMIN",
  "RECEPTIONIST",
  "CALL_OPERATOR",
] as const;

export const LeadStatusEnum = z.enum([
  "NEW",
  "CONTACTED",
  "CONVERTED",
  "CANCELLED",
]);
export const LeadSourceEnum = z.enum([
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
]);
export const ChannelTypeEnum = z.enum([
  "WALKIN",
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
  "KIOSK",
]);

/**
 * Reception works a request by status and a note. `patientId` and the
 * appointment link are set by the booking itself (bookAppointment with
 * `leadId`), never typed in, so they are not accepted here.
 */
export const UpdateOnlineRequestSchema = z
  .object({
    status: LeadStatusEnum.optional(),
    comment: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.comment !== undefined, {
    message: "empty_patch",
  });

export const QueryOnlineRequestSchema = z.object({
  status: LeadStatusEnum.optional(),
  source: LeadSourceEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type UpdateOnlineRequest = z.infer<typeof UpdateOnlineRequestSchema>;
