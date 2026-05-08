/**
 * Phase 19 Wave 2 — public self-service signup schemas.
 *
 * Independent from `src/server/schemas/platform.ts` because these are NOT
 * SUPER_ADMIN endpoints — anyone can hit `/api/public/signup` and the
 * confirm endpoint. The shape is intentionally minimal: the visitor
 * gives us only what we need to mint a clinic + admin + trial sub.
 */
import { z } from "zod";

import { PLAYBOOK_SLUGS } from "@/server/onboarding/playbooks";

const PlaybookSlugEnum = z.enum(PLAYBOOK_SLUGS);

export const SignupRequestSchema = z.object({
  clinicName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  // Phone is optional: some clinics may want to register before having a
  // dedicated public number. Loose validation — UZ phones come in many
  // formats and the receptionist can fix it later in /crm/settings/clinic.
  phone: z.string().trim().min(4).max(40).optional(),
  planSlug: z.enum(["basic", "pro"]).default("basic"),
  // null / omitted = "start blank" path. Wave 2 only ships the 5 catalog
  // slugs; Wave 3 may add more.
  playbookSlug: PlaybookSlugEnum.nullish(),
  preferredLocale: z.enum(["ru", "uz"]).default("ru"),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const SignupConfirmSchema = z.object({
  token: z.string().min(8).max(200),
});
export type SignupConfirm = z.infer<typeof SignupConfirmSchema>;
