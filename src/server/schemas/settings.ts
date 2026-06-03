/**
 * Settings-related schemas.
 * See docs/TZ.md §10.Фаза 4.
 */
import { z } from "zod";

const CurrencyEnum = z.enum(["UZS", "USD"]);

/**
 * Clinic self-edit (tenant admin). Slug and id are immutable here.
 */
export const UpdateClinicSettingsSchema = z.object({
  nameRu: z.string().min(1).max(200).optional(),
  nameUz: z.string().min(1).max(200).optional(),
  addressRu: z.string().max(500).optional().nullable(),
  addressUz: z.string().max(500).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  timezone: z.string().optional(),
  currency: CurrencyEnum.optional(),
  secondaryCurrency: CurrencyEnum.nullable().optional(),
  workdayStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  workdayEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  slotMin: z.number().int().min(5).max(240).optional(),
  active: z.boolean().optional(),
  // Phase 16 Wave 2 — Patient experience: cutoff for the LOW_NPS_RECEIVED
  // Action emit. Score < threshold fires an alert. 1..10 mirrors the form.
  npsAlertThreshold: z.number().int().min(1).max(10).optional(),
  // Phase 16 Wave 3 — Refer-a-friend reward percent applied to the
  // referrer's next booking. 0..50; 0 disables the reward.
  referralRewardPercent: z.number().int().min(0).max(50).optional(),
  // Phase 16 Wave 3 — Master switch for the medication-reminder worker.
  medicationRemindersEnabled: z.boolean().optional(),
  // Phase 17 Wave 2 — Mandatory 2FA for every staff role. Plan-gated to
  // Pro / Enterprise (the API rejects the flip on Basic). The schema only
  // type-checks here; the gate is in the route handler.
  require2faForAll: z.boolean().optional(),
  // Phase 17 Wave 2 — Per-clinic idle-session timeout in minutes. Bound is
  // [5, 240]; 30 is the default.
  sessionIdleTimeoutMinutes: z.number().int().min(5).max(240).optional(),
});

export type UpdateClinicSettings = z.infer<typeof UpdateClinicSettingsSchema>;

/**
 * Integration settings (ProviderConnection upsert).
 * `secret` is the plain-text credential; server encrypts / stores as `secretCipher`.
 * For Phase-4 we store base64 as a placeholder cipher — a proper KMS wrapping
 * will be added in Phase 6.
 */
export const ProviderKindEnum = z.enum([
  "TELEGRAM",
  "SMS",
  "PAYME",
  "CLICK",
  "UZUM",
  "OPENAI",
  "OTHER",
]);

export const UpsertProviderSchema = z.object({
  kind: ProviderKindEnum,
  label: z.string().max(120).optional().nullable(),
  secret: z.string().max(4000).optional(),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
  active: z.boolean().optional(),
  /** Current user's password — required when secret is changing. */
  currentPassword: z.string().max(200).optional(),
});

export type UpsertProvider = z.infer<typeof UpsertProviderSchema>;

/**
 * Tokens/secrets re-entry for protected clinic fields.
 */
export const ClinicSecretsSchema = z.object({
  tgBotToken: z.string().max(400).optional().nullable(),
  tgBotUsername: z.string().max(100).optional().nullable(),
  tgWebhookSecret: z.string().max(200).optional().nullable(),
  smsSenderName: z.string().max(100).optional().nullable(),
  currentPassword: z.string().min(1).max(200),
});

export type ClinicSecrets = z.infer<typeof ClinicSecretsSchema>;

/**
 * Reset-password payload. Either a new password provided, or server
 * generates a random one and returns it once.
 */
export const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200).optional(),
});

export type ResetPassword = z.infer<typeof ResetPasswordSchema>;

/**
 * Test-SMS payload for the settings page.
 */
export const TestSmsSchema = z.object({
  phone: z.string().min(5).max(40),
  body: z.string().min(1).max(500),
});

export type TestSms = z.infer<typeof TestSmsSchema>;

/**
 * Phase 19 Wave 4 — white-label branding self-edit (Pro / Enterprise plans).
 *
 * The PATCH route accepts a JSON body with any subset of these keys; logo
 * upload travels separately on the same multipart request (file field name
 * `logo`). `customSubdomain` is `null` to clear, a non-empty string to set;
 * `undefined` (key absent) means "leave unchanged".
 */
import { SubdomainZ } from "@/server/platform/subdomain";

export const UpdateBrandingSchema = z
  .object({
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "invalid_hex")
      .optional(),
    brandSecondaryColor: z
      .union([
        z.literal(""),
        z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid_hex"),
      ])
      .nullable()
      .optional(),
    customSubdomain: z.union([z.literal(""), SubdomainZ]).nullable().optional(),
    // Set when the multipart route already wrote the file; the API hands it
    // back into the schema so the audit log records the same path.
    logoUrl: z.string().url().nullable().optional(),
  })
  .strict();
export type UpdateBranding = z.infer<typeof UpdateBrandingSchema>;
