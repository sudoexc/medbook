/**
 * Phase 18 Wave 4 — zod schemas for the scheduled-report API.
 *
 * Kept in a tiny module so the route handlers AND the unit tests can import
 * the same source of truth — the W4 spec calls out 422 on bad email / TG
 * chat-id, and the schema is the single place those checks live.
 */
import { z } from "zod";

export const SCHEDULE_CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export const SCHEDULE_CHANNELS = ["EMAIL", "TELEGRAM"] as const;
export const SCHEDULE_FORMATS = ["pdf", "csv"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TG_CHAT_ID_RE = /^-?\d{4,20}$/;

const Cadence = z.enum(SCHEDULE_CADENCES);
const Channel = z.enum(SCHEDULE_CHANNELS);
const Format = z.enum(SCHEDULE_FORMATS);

function refineTarget<T extends { deliveryChannel: "EMAIL" | "TELEGRAM"; deliveryTarget?: string }>(
  ctx: z.RefinementCtx,
  v: T,
): void {
  const target = v.deliveryTarget ?? "";
  if (v.deliveryChannel === "EMAIL") {
    if (!EMAIL_RE.test(target.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["deliveryTarget"],
        message: "invalid_email",
      });
    }
    return;
  }
  if (v.deliveryChannel === "TELEGRAM") {
    if (!TG_CHAT_ID_RE.test(target.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["deliveryTarget"],
        message: "invalid_telegram_chat_id",
      });
    }
  }
}

export const CreateScheduleBodySchema = z
  .object({
    cadence: Cadence,
    deliveryChannel: Channel,
    deliveryTarget: z.string().min(1).max(255),
    format: Format.default("pdf"),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => refineTarget(ctx, v));

export const UpdateScheduleBodySchema = z
  .object({
    cadence: Cadence.optional(),
    deliveryChannel: Channel.optional(),
    deliveryTarget: z.string().min(1).max(255).optional(),
    format: Format.optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    // If channel + target are BOTH being changed, validate the pair.
    if (v.deliveryChannel && v.deliveryTarget) {
      refineTarget(ctx, {
        deliveryChannel: v.deliveryChannel,
        deliveryTarget: v.deliveryTarget,
      });
      return;
    }
    // If only target is changing we can't validate without the existing
    // channel — the route handler does the fetch + revalidation.
  });

export type CreateScheduleBody = z.infer<typeof CreateScheduleBodySchema>;
export type UpdateScheduleBody = z.infer<typeof UpdateScheduleBodySchema>;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}
export function isValidTelegramChatId(s: string): boolean {
  return TG_CHAT_ID_RE.test(s.trim());
}
