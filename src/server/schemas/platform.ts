/**
 * Zod schemas for SUPER_ADMIN `/api/platform/*` endpoints.
 *
 * Distinct from `src/server/schemas/settings.ts` (owned by
 * settings-pages-builder). The platform schemas include a few fields that
 * per-clinic settings don't expose (slug immutability rules, clinic-level
 * active toggle, cross-tenant user reassign).
 */
import { z } from "zod";

const CurrencyEnum = z.enum(["UZS", "USD"]);
const RoleEnum = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
]);
const ProviderKindEnum = z.enum([
  "TELEGRAM",
  "SMS",
  "PAYME",
  "CLICK",
  "UZUM",
  "OPENAI",
  "OTHER",
]);

/** Provider "family" as surfaced in the UI — maps to one or more Prisma ProviderKind values. */
export const ProviderFamilyEnum = z.enum([
  "SMS",
  "TG",
  "PAYMENT",
  "TELEPHONY",
]);
export type ProviderFamily = z.infer<typeof ProviderFamilyEnum>;

export const CreateClinicSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case (a-z, 0-9, dash)"),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  addressRu: z.string().max(500).nullish(),
  addressUz: z.string().max(500).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(200).nullish(),
  timezone: z.string().max(60).default("Asia/Tashkent"),
  currency: CurrencyEnum.default("UZS"),
  secondaryCurrency: CurrencyEnum.nullish(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3DD5C0"),
  active: z.boolean().default(true),
});
export type CreateClinic = z.infer<typeof CreateClinicSchema>;

export const UpdateClinicSchema = z.object({
  nameRu: z.string().min(1).max(200).optional(),
  nameUz: z.string().min(1).max(200).optional(),
  addressRu: z.string().max(500).nullish(),
  addressUz: z.string().max(500).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(200).nullish(),
  timezone: z.string().max(60).optional(),
  currency: CurrencyEnum.optional(),
  secondaryCurrency: CurrencyEnum.nullish(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  active: z.boolean().optional(),
});
export type UpdateClinic = z.infer<typeof UpdateClinicSchema>;

/**
 * Provider connection upsert for the admin platform. `secret` is the raw
 * plaintext — the route encrypts into `secretCipher`. If omitted on an
 * update, the stored cipher is preserved (write-only field).
 */
export const UpsertPlatformIntegrationSchema = z.object({
  family: ProviderFamilyEnum,
  kind: ProviderKindEnum,
  label: z.string().max(120).nullish(),
  secret: z.string().max(4000).optional(),
  config: z.record(z.string(), z.unknown()).nullish(),
  active: z.boolean().optional(),
});
export type UpsertPlatformIntegration = z.infer<
  typeof UpsertPlatformIntegrationSchema
>;

export const PatchPlatformIntegrationSchema = z.object({
  label: z.string().max(120).nullish(),
  secret: z.string().max(4000).optional(),
  config: z.record(z.string(), z.unknown()).nullish(),
  active: z.boolean().optional(),
});
export type PatchPlatformIntegration = z.infer<
  typeof PatchPlatformIntegrationSchema
>;

export const QueryPlatformUsersSchema = z.object({
  q: z.string().max(200).optional(),
  role: RoleEnum.optional(),
  clinicId: z.string().optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const PatchPlatformUserSchema = z.object({
  clinicId: z.string().nullish(),
  role: RoleEnum.optional(),
  active: z.boolean().optional(),
});
export type PatchPlatformUser = z.infer<typeof PatchPlatformUserSchema>;

export const QueryPlatformUsageSchema = z.object({
  period: z.enum(["week", "month"]).default("month"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const QueryPlatformAuditSchema = z.object({
  clinicId: z.string().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const SwitchClinicSchema = z.object({
  clinicId: z.string().min(1).max(100).nullable(),
});
export type SwitchClinic = z.infer<typeof SwitchClinicSchema>;

/**
 * Phase 9c — Subscription PATCH body for `/api/admin/clinics/[id]/subscription`.
 *
 * Every key is optional — handlers apply only the fields that were sent. Dates
 * arrive as ISO strings (or `null` to clear) and are coerced via `z.coerce.date()`.
 * `cancelledAt` is normally written by the dedicated `/cancel` endpoint, but is
 * exposed here so a SUPER_ADMIN can revert a soft-cancellation by clearing it.
 */
const SubscriptionStatusEnum = z.enum([
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
]);

export const PatchSubscriptionSchema = z.object({
  planId: z.string().min(1).max(100).optional(),
  status: SubscriptionStatusEnum.optional(),
  trialEndsAt: z.coerce.date().nullish(),
  currentPeriodEndsAt: z.coerce.date().nullish(),
  cancelledAt: z.coerce.date().nullish(),
});
export type PatchSubscription = z.infer<typeof PatchSubscriptionSchema>;

/**
 * Maps each UI "family" to the set of Prisma ProviderKind values it can store.
 * Used by the integrations page to group rows.
 */
export const FAMILY_KINDS: Record<ProviderFamily, string[]> = {
  SMS: ["SMS"],
  TG: ["TELEGRAM"],
  PAYMENT: ["PAYME", "CLICK", "UZUM"],
  TELEPHONY: ["OTHER"], // telephony parked on OTHER with label="sip" until enum adds SIP
};
